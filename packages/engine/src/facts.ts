// What the graph pass learns about each file's code units, kept so nothing asks TypeScript again for it (phase 7;
// owner, 13 Nov 2026: compute once, store, reuse). One row per file: its units' ranges and the inspector's details,
// compressed. The semantic worker writes rows as the pass walks files; the engine reads one file's when asked, so the
// inspector and flows opened from inside a function answer in milliseconds, after a restart too. Each row holds the
// hash of the text it was worked out from; the engine checks it against the file on every read, so a file changed
// since (in any way: an edit, a checkout, while the engine was stopped) is never answered from here: TypeScript is.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import type { NodeDetails } from './protocol.js';
import type { UnitFacts } from './semantics/details.js';

/** Raise when a row's shape changes: rows in another format are dropped, and the next pass writes them again. */
/** 2: each unit's calls, and which files call a place (the Calls tab, phase 7 step 4). */
export const FACTS_FORMAT = 2;
/** Files kept decoded in memory: the ones being looked at. */
const DECODED_KEPT = 64;

// `calls_into`: which files have a unit calling a place (a callee's `path:line:column`), from TypeScript's call
// hierarchy, so a function's callers are its callers' own stored calls, as TypeScript's incoming calls are.
const SCHEMA = `
  CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, data BLOB NOT NULL);
  CREATE TABLE calls_into (target TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (target, path));
  CREATE INDEX calls_into_path ON calls_into (path);
`;

/** The key a callee's place is stored by. */
const placeKey = (place: {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}) => `${place.path}:${String(place.line)}:${String(place.column)}`;

/** A file's units, and the hash of the text they were worked out from. */
export interface FileFacts {
  readonly hash: string;
  readonly units: readonly UnitFacts[];
}

/** The hash a file's facts are checked by: its text, less a byte-order mark (TypeScript drops one when it reads). */
export const contentHash = (text: string): string =>
  createHash('sha1')
    .update(text.replace(/^\uFEFF/, ''))
    .digest('hex');

export class FactsStore {
  readonly #db: DatabaseSync;
  readonly #root: string | undefined;
  readonly #decoded = new Map<string, FileFacts>();
  #pending = new Map<string, FileFacts | null>();

  /**
   * Opens (or creates) the store at `file`, by the worker (writing) and the engine (reading); `:memory:` for tests.
   * With `root`, the project's folder, every read checks the file's text against the row's hash.
   */
  constructor(file: string, options: { readonly root?: string } = {}) {
    this.#root = options.root;
    this.#db = new DatabaseSync(file);
    this.#db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;',
    );
    const current = this.#db.prepare('PRAGMA user_version').get()?.user_version;
    if (current !== FACTS_FORMAT) {
      this.#db.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS calls_into;');
      this.#db.exec(SCHEMA);
      this.#db.exec(`PRAGMA user_version = ${String(FACTS_FORMAT)}`);
    }
  }

  /** A file's facts (null: the file is gone), written with the next `flush`. */
  put(path: string, facts: FileFacts | null): void {
    this.#pending.set(path, facts);
  }

  /** Writes what was put, in one transaction. */
  flush(): void {
    if (this.#pending.size === 0) return;
    const pending = this.#pending;
    this.#pending = new Map();
    const upsert = this.#db.prepare(
      `INSERT INTO files (path, hash, data) VALUES (?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET hash = excluded.hash, data = excluded.data`,
    );
    const remove = this.#db.prepare('DELETE FROM files WHERE path = ?');
    const unlink = this.#db.prepare('DELETE FROM calls_into WHERE path = ?');
    const link = this.#db.prepare('INSERT OR IGNORE INTO calls_into (target, path) VALUES (?, ?)');
    this.#db.exec('BEGIN');
    try {
      for (const [path, facts] of pending) {
        unlink.run(path);
        if (facts === null) {
          remove.run(path);
        } else {
          upsert.run(path, facts.hash, zstdCompressSync(JSON.stringify(facts.units)));
          for (const unit of facts.units) {
            for (const callee of unit.calls?.callees ?? []) {
              if (callee.hierarchy && callee.place !== null) link.run(placeKey(callee.place), path);
            }
          }
        }
        this.#decoded.delete(path);
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** After a whole-project pass: drops the rows of files it didn't walk (deleted while the engine was stopped). */
  keepOnly(paths: ReadonlySet<string>): void {
    this.flush();
    const gone = this.#db
      .prepare('SELECT path FROM files')
      .all()
      .map((row) => String(row.path))
      .filter((path) => !paths.has(path));
    for (const path of gone) this.put(path, null);
    this.flush();
  }

  /**
   * A file's units, or undefined when the pass hasn't stored it, or (with a root) when the file's text isn't what they
   * were worked out from.
   */
  units(path: string): readonly UnitFacts[] | undefined {
    const facts = this.#facts(path);
    if (facts === undefined) return undefined;
    if (this.#root !== undefined) {
      let text: string;
      try {
        text = readFileSync(join(this.#root, path), 'utf8');
      } catch {
        return undefined;
      }
      if (contentHash(text) !== facts.hash) return undefined;
    }
    return facts.units;
  }

  #facts(path: string): FileFacts | undefined {
    const known = this.#decoded.get(path);
    if (known !== undefined) {
      // Most recently used last, so the oldest goes first.
      this.#decoded.delete(path);
      this.#decoded.set(path, known);
      return known;
    }
    const row = this.#db.prepare('SELECT hash, data FROM files WHERE path = ?').get(path);
    if (row === undefined) return undefined;
    const facts: FileFacts = {
      hash: String(row.hash),
      units: JSON.parse(
        zstdDecompressSync(row.data as Uint8Array).toString('utf8'),
      ) as readonly UnitFacts[],
    };
    this.#decoded.set(path, facts);
    if (this.#decoded.size > DECODED_KEPT) {
      const oldest = this.#decoded.keys().next().value;
      if (oldest !== undefined) this.#decoded.delete(oldest);
    }
    return facts;
  }

  /**
   * The code unit at a place: the innermost range holding it (ranges nest, as the code does). Anywhere none holds (past
   * the file's last character) is the top level, which comes first.
   */
  unitAt(path: string, line: number, column: number): UnitFacts | undefined {
    const units = this.units(path) ?? [];
    let found: UnitFacts | undefined;
    for (const unit of units) {
      if (holds(unit, line, column) && (found === undefined || holds(found, ...unit.start))) {
        found = unit;
      }
    }
    return found ?? units[0];
  }

  /** The files with a unit calling the function at `place` (by TypeScript's call hierarchy). */
  callerFiles(place: {
    readonly path: string;
    readonly line: number;
    readonly column: number;
  }): readonly string[] {
    return this.#db
      .prepare('SELECT path FROM calls_into WHERE target = ? ORDER BY path')
      .all(placeKey(place))
      .map((row) => String(row.path));
  }

  /** Drops the decoded copies: after a pass, which may have rewritten any file's rows from another connection. */
  forget(): void {
    this.#decoded.clear();
  }

  /** A unit's details by its id (its file is the id's path). */
  details(id: string): NodeDetails | undefined {
    const path = id.slice(0, id.indexOf('#'));
    return this.units(path)?.find((unit) => unit.id === id)?.details;
  }

  close(): void {
    this.#db.close();
  }
}

/** Whether a unit's range holds a place: from its start, up to (not including) its end. */
const holds = (unit: UnitFacts, line: number, column: number): boolean =>
  (line > unit.start[0] || (line === unit.start[0] && column >= unit.start[1])) &&
  (line < unit.end[0] || (line === unit.end[0] && column < unit.end[1]));
