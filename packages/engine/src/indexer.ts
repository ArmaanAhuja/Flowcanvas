// The indexer (phase 4, ADR 0024): keeps the index in line with the project's files. Incremental by
// content: a file whose SHA-256 is the one already indexed isn't parsed again.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { IGNORED_DIRECTORIES, isSecretFile, LIMITS } from '@flowcanvas/workspace-agent/protocol';
import { Parser } from 'web-tree-sitter';
import { languageOf, limitationOf, loadGrammars } from './grammars.js';
import type { FileRecord, IndexStore } from './store.js';
import { extractSymbols, type FileSymbol } from './symbols.js';

export interface IndexerOptions {
  /** The project's folder; paths are relative to it. */
  readonly root: string;
  readonly store: IndexStore;
  /** Files written per transaction; between batches, other work (a search) gets a turn. */
  readonly batchSize?: number;
  /** Larger files aren't read (default: the agent's file limit, 1 MB). */
  readonly maxFileBytes?: number;
}

export interface IndexProgress {
  readonly done: number;
  readonly total: number;
}

export interface IndexRun {
  /** Paths looked at. */
  readonly checked: number;
  /** Parsed this time: new or changed. */
  readonly parsed: number;
  /** Already indexed with the same content (or, for unread files, the same outcome). */
  readonly unchanged: number;
  /** Gone from the project, so dropped from the index. */
  readonly removed: number;
  readonly ms: number;
}

/** A change the watcher reported (ADR 0022). The file is read again and skipped if its content
 * is what's indexed (a rewrite with the same bytes). */
export interface ChangedPath {
  readonly path: string;
  readonly deleted?: boolean;
}

// A file with a NUL byte in its first 8 KB is binary, whatever its extension (git's own rule).
const BINARY_SNIFF_BYTES = 8000;
const DEFAULT_BATCH = 100;

type Outcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'record'; readonly record: FileRecord; readonly text?: string };

export class Indexer {
  readonly #root: string;
  readonly #store: IndexStore;
  readonly #batchSize: number;
  readonly #maxFileBytes: number;
  #parser: Parser | undefined;
  // One run at a time: a refresh during a full sync waits for it.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: IndexerOptions) {
    this.#root = options.root;
    this.#store = options.store;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH;
    this.#maxFileBytes = options.maxFileBytes ?? LIMITS.fileBytes;
  }

  /**
   * Brings the index in line with `files`, the project's whole file list (the agent's, from git):
   * new and changed files are parsed, and files no longer listed are dropped.
   */
  sync(
    files: readonly string[],
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<IndexRun> {
    return this.#serial(async () => {
      const started = performance.now();
      const wanted = [...new Set(files)].filter(indexable);
      const keep = new Set(wanted);
      const gone = this.#store.paths().filter((path) => !keep.has(path));
      this.#store.transaction(() => {
        gone.forEach((path) => {
          this.#store.remove(path);
        });
      });
      const counts = await this.#index(wanted, onProgress);
      return { ...counts, removed: gone.length, ms: Math.round(performance.now() - started) };
    });
  }

  /** Re-checks only these paths, as the watcher reports them changed or deleted. */
  refresh(changes: readonly ChangedPath[]): Promise<IndexRun> {
    return this.#serial(async () => {
      const started = performance.now();
      const deleted = changes.filter((c) => c.deleted === true).map((c) => c.path);
      const changed = changes.filter((c) => c.deleted !== true).map((c) => c.path);
      // A secret or ignored path may have been indexed by an older rule: never keep it.
      const removed = [...deleted, ...changed.filter((path) => !indexable(path))].filter(
        (path) => this.#store.versionOf(path) !== undefined,
      );
      this.#store.transaction(() => {
        removed.forEach((path) => {
          this.#store.remove(path);
        });
      });
      const counts = await this.#index([...new Set(changed.filter(indexable))]);
      return { ...counts, removed: removed.length, ms: Math.round(performance.now() - started) };
    });
  }

  /** Frees the parser. The store belongs to the caller. */
  async close(): Promise<void> {
    await this.#queue.catch(() => undefined);
    this.#parser?.delete();
    this.#parser = undefined;
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #index(
    paths: readonly string[],
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<Omit<IndexRun, 'removed' | 'ms'>> {
    const grammars = await loadGrammars();
    this.#parser ??= new Parser();
    const parser = this.#parser;
    let parsed = 0;
    let unchanged = 0;
    onProgress?.({ done: 0, total: paths.length });
    for (let start = 0; start < paths.length; start += this.#batchSize) {
      const batch = paths.slice(start, start + this.#batchSize);
      // Reading is asynchronous; parsing and writing a batch is one synchronous transaction.
      const outcomes = await Promise.all(batch.map((path) => this.#inspect(path)));
      this.#store.transaction(() => {
        for (const outcome of outcomes) {
          if (outcome.kind === 'unchanged') {
            unchanged++;
            continue;
          }
          if (outcome.kind === 'skip') continue;
          const { record, text } = outcome;
          let symbols: FileSymbol[] = [];
          let syntaxErrors = false;
          if (text !== undefined && record.language !== null) {
            parser.setLanguage(grammars.get(record.language) ?? null);
            const tree = parser.parse(text);
            if (tree !== null) {
              try {
                syntaxErrors = tree.rootNode.hasError;
                symbols = extractSymbols(record.language, tree);
              } finally {
                tree.delete();
              }
            }
            parsed++;
          }
          this.#store.put({ ...record, syntaxErrors }, symbols);
        }
      });
      onProgress?.({ done: Math.min(start + batch.length, paths.length), total: paths.length });
      await nextTurn();
    }
    return { checked: paths.length, parsed, unchanged };
  }

  /** What a file is now, without parsing it: unread, unchanged, or text to parse. */
  async #inspect(path: string): Promise<Outcome> {
    const language = languageOf(path);
    const limitation = limitationOf(path);
    const known = this.#store.file(path);
    const unread = (status: FileRecord['status']): Outcome =>
      known?.status === status && known.version === null
        ? { kind: 'unchanged' }
        : {
            kind: 'record',
            record: { path, version: null, language, status, syntaxErrors: false, limitation },
          };

    if (language === null) return unread('no-grammar');
    const full = join(this.#root, path);
    let bytes: Buffer;
    try {
      // lstat, so a link is never followed out of the project.
      const info = await lstat(full);
      if (!info.isFile()) return unread('unreadable');
      if (info.size > this.#maxFileBytes) return unread('too-large');
      bytes = await readFile(full);
    } catch {
      return unread('unreadable');
    }
    if (bytes.length > this.#maxFileBytes) return unread('too-large');
    const version = createHash('sha256').update(bytes).digest('hex');
    if (known?.version === version) return { kind: 'unchanged' };
    const record = { path, version, language, syntaxErrors: false, limitation };
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { kind: 'record', record: { ...record, status: 'binary' } };
    }
    // Invalid UTF-8 becomes U+FFFD rather than failing: the file is still parsed.
    const text = new TextDecoder('utf-8').decode(bytes);
    return { kind: 'record', record: { ...record, status: 'parsed' }, text };
  }
}

/**
 * Never indexed: secret files (CLAUDE.md rule 5; not even their names are stored), anything inside
 * dependency, git or build folders, and paths that could leave the project.
 */
export function indexable(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.length > LIMITS.pathLength) return false;
  const segments = path.split('/');
  if (
    segments.some((s) => s === '' || s === '.' || s === '..' || IGNORED_DIRECTORIES.includes(s))
  ) {
    return false;
  }
  return !isSecretFile(segments.at(-1) ?? '');
}
