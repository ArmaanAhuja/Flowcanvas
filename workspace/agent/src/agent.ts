// The workspace agent (phase 1d step 5): runs inside the workspace container as the workspace's own user and
// answers file and process requests about the project. It can't do anything the workspace's user can't, so
// the host and the control plane treat its answers as untrusted.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  AGENT_PROTOCOL,
  AgentProblem,
  IGNORED_DIRECTORIES,
  LIMITS,
  isSecretFile,
  parseAgentRequest,
  type AgentRequest,
  type AgentResponse,
  type AgentResult,
  type Entry,
  type Envelope,
  type JournalSummary,
  type Results,
  type Version,
} from './protocol.js';

const SECRET_MESSAGE =
  'Secrets live in the project’s vault, not in .env files, so they can’t be opened here.';

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** A file's version: the SHA-256 of its bytes. */
export const versionOf = (bytes: Uint8Array): Version =>
  createHash('sha256').update(bytes).digest('hex');

const CONFLICT_MESSAGE = 'This file changed in the workspace since you opened it.';

/** Runs `action` after any earlier action for the same key has finished: one at a time per file. */
function serialiser() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(action, action);
    const tail = next.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
}

interface StoredEntry {
  readonly path: string;
  readonly baseVersion: Version | null;
  readonly revision: number;
  readonly updatedAt: number;
  readonly content: string;
}

function parseStored(text: string): StoredEntry | undefined {
  try {
    const value = JSON.parse(text) as Partial<StoredEntry>;
    if (
      typeof value.path === 'string' &&
      (value.baseVersion === null || typeof value.baseVersion === 'string') &&
      typeof value.revision === 'number' &&
      typeof value.updatedAt === 'number' &&
      typeof value.content === 'string'
    ) {
      return value as StoredEntry;
    }
  } catch {
    // A damaged entry is skipped, never shown as someone's work.
  }
  return undefined;
}

export interface Agent {
  handle(request: AgentRequest): Promise<AgentResult>;
}

export interface AgentOptions {
  readonly root: string;
  /** Where unsaved buffers are kept; by default `.flowcanvas/journal` beside the project (JOURNAL_ROOT). */
  readonly journal?: string;
  /** The clock for journal entries; tests pass their own. */
  readonly now?: () => number;
}

export function createAgent(options: AgentOptions): Agent {
  const root = resolve(options.root);
  const journalRoot = resolve(options.journal ?? join(dirname(root), '.flowcanvas', 'journal'));
  const now = options.now ?? Date.now;
  const oneAtATime = serialiser();
  let realRoot: string | undefined;

  async function projectRoot(): Promise<string> {
    try {
      realRoot ??= await realpath(root);
      return realRoot;
    } catch {
      throw new AgentProblem('not_found', 'This workspace has no project files yet.');
    }
  }

  function isInside(base: string, target: string): boolean {
    return target === base || target.startsWith(base + sep);
  }

  /** The absolute path for a project-relative one, refusing anything that leaves the project. */
  async function locate(path: string): Promise<{ target: string; shown: string }> {
    const base = await projectRoot();
    const target = resolve(base, path === '' ? '.' : path);
    if (!isInside(base, target)) {
      throw new AgentProblem('outside_project', 'That path is outside the project.');
    }
    return { target, shown: relative(base, target) };
  }

  /** Follows links for an existing path, and refuses one that ends up outside the project. */
  async function real(target: string): Promise<string> {
    let resolved: string;
    try {
      resolved = await realpath(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new AgentProblem('not_found', 'There’s nothing at that path.');
      throw error;
    }
    if (!isInside(await projectRoot(), resolved)) {
      throw new AgentProblem('outside_project', 'That link points outside the project.');
    }
    return resolved;
  }

  async function list(path: string): Promise<Results['list']> {
    const { target, shown } = await locate(path);
    const directory = await real(target);
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOTDIR')
        throw new AgentProblem('not_a_directory', 'That’s a file, not a folder.');
      throw error;
    }
    const entries: Entry[] = [];
    for (const dirent of names.slice(0, LIMITS.entries)) {
      const stats = await lstat(resolve(directory, dirent.name)).catch(() => undefined);
      entries.push({
        name: dirent.name,
        type: dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : dirent.isSymbolicLink()
              ? 'symlink'
              : 'other',
        size: dirent.isFile() ? (stats?.size ?? 0) : 0,
        secret: isSecretFile(dirent.name),
      });
    }
    entries.sort((a, b) =>
      a.type === b.type || (a.type !== 'directory' && b.type !== 'directory')
        ? a.name.localeCompare(b.name)
        : a.type === 'directory'
          ? -1
          : 1,
    );
    return { path: shown, entries, truncated: names.length > LIMITS.entries };
  }

  async function read(path: string): Promise<Results['read']> {
    const { target, shown } = await locate(path);
    if (isSecretFile(basename(target))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const file = await real(target);
    if (isSecretFile(basename(file))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const stats = await lstat(file);
    if (stats.isDirectory())
      throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
    if (!stats.isFile())
      throw new AgentProblem('not_allowed', 'Only ordinary files can be opened.');
    if (stats.size > LIMITS.fileBytes)
      throw new AgentProblem('too_large', 'Files over 1 MB can’t be opened here yet.');
    const bytes = await readFile(file);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.includes('\0'))
        return {
          path: shown,
          size: bytes.length,
          encoding: 'utf8',
          content: text,
          version: versionOf(bytes),
        };
    } catch {
      // Not UTF-8: sent as base64 below.
    }
    return {
      path: shown,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
      version: versionOf(bytes),
    };
  }

  /** The file's current version, or null if there's none; never through a link. */
  async function currentVersion(target: string): Promise<Version | null> {
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      if (errorCode(error) === 'ELOOP')
        throw new AgentProblem('not_allowed', 'That’s a link; open the file it points to.');
      if (errorCode(error) === 'EISDIR')
        throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
      throw error;
    }
    try {
      return versionOf(await handle.readFile());
    } catch (error) {
      if (errorCode(error) === 'EISDIR')
        throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
      throw error;
    } finally {
      await handle.close();
    }
  }

  async function write(
    path: string,
    content: string,
    encoding: 'utf8' | 'base64',
    baseVersion: Version | null | undefined,
  ): Promise<Results['write']> {
    const { target } = await locate(path);
    // One write at a time per file, so a version check and its write can't interleave with another save.
    return oneAtATime(`file:${target}`, () => writeNow(path, content, encoding, baseVersion));
  }

  async function writeNow(
    path: string,
    content: string,
    encoding: 'utf8' | 'base64',
    baseVersion: Version | null | undefined,
  ): Promise<Results['write']> {
    const { target, shown } = await locate(path);
    if (target === (await projectRoot()))
      throw new AgentProblem('is_a_directory', 'Give a file’s path.');
    if (isSecretFile(basename(target))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const bytes =
      encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    if (bytes.length > LIMITS.fileBytes)
      throw new AgentProblem('too_large', 'Keep files under 1 MB.');

    // The nearest folder that exists must really be inside the project (no link out), then make the rest.
    let existing = dirname(target);
    while (
      !(await lstat(existing).then(
        () => true,
        () => false,
      ))
    )
      existing = dirname(existing);
    if (!(await lstat(await real(existing))).isDirectory()) {
      throw new AgentProblem('not_a_directory', 'Part of that path is a file.');
    }
    await mkdir(dirname(target), { recursive: true });
    await real(dirname(target));

    // Conflict-safe: refuse if the file isn't the version the content was edited from. (Another program could
    // still change it in the moment between this check and the write; the watcher reports that, phase 3.)
    if (baseVersion !== undefined && (await currentVersion(target)) !== baseVersion) {
      throw new AgentProblem('conflict', CONFLICT_MESSAGE);
    }

    let handle;
    try {
      // O_NOFOLLOW: never write through a link, even one made after the checks above.
      handle = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o644,
      );
    } catch (error) {
      if (errorCode(error) === 'ELOOP')
        throw new AgentProblem('not_allowed', 'That’s a link; open the file it points to.');
      if (errorCode(error) === 'EISDIR')
        throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
      if (errorCode(error) === 'ENOTDIR')
        throw new AgentProblem('not_a_directory', 'Part of that path is a file.');
      throw error;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return { path: shown, size: bytes.length, version: versionOf(bytes) };
  }

  /** Runs a program in the project without a shell; undefined if it can't run or fails. */
  function run(program: string, args: readonly string[], cwd: string): Promise<Buffer | undefined> {
    return new Promise((done) => {
      const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      let size = 0;
      // Room for 50,000 paths at about 160 characters.
      const most = 8 * 1024 * 1024;
      child.stdout.on('data', (chunk: Buffer) => {
        if (size < most) chunks.push(chunk);
        size += chunk.length;
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
      child.on('error', () => {
        clearTimeout(timer);
        done(undefined);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        done(code === 0 ? Buffer.concat(chunks) : undefined);
      });
    });
  }

  const nulSeparated = (bytes: Buffer) =>
    bytes
      .toString('utf8')
      .split('\0')
      .filter((path) => path !== '');

  /** Tracked and untracked files git doesn't ignore, without deleted ones; undefined if this isn't a repository. */
  async function gitFiles(base: string): Promise<string[] | undefined> {
    const all = await run(
      'git',
      ['-c', 'core.quotepath=off', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      base,
    );
    if (all === undefined) return undefined;
    const deleted = await run(
      'git',
      ['-c', 'core.quotepath=off', 'ls-files', '-z', '--deleted'],
      base,
    );
    const gone = new Set(deleted === undefined ? [] : nulSeparated(deleted));
    return [...new Set(nulSeparated(all))].filter((path) => !gone.has(path));
  }

  /** Every file outside the ignored folders, without following links; stops past the limit. */
  async function walkFiles(base: string): Promise<string[]> {
    const found: string[] = [];
    const folders = [''];
    while (folders.length > 0 && found.length <= LIMITS.files) {
      const folder = folders.shift() ?? '';
      const dirents = await readdir(resolve(base, folder), { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        const path = folder === '' ? dirent.name : `${folder}/${dirent.name}`;
        if (dirent.isDirectory()) {
          if (!IGNORED_DIRECTORIES.includes(dirent.name)) folders.push(path);
        } else if (dirent.isFile()) {
          found.push(path);
        }
      }
    }
    return found;
  }

  async function files(): Promise<Results['files']> {
    const base = await projectRoot();
    const fromGit = await gitFiles(base);
    const all = (fromGit ?? (await walkFiles(base)))
      .filter((path) => !isSecretFile(path.split('/').pop() ?? ''))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      files: all.slice(0, LIMITS.files),
      truncated: all.length > LIMITS.files,
      source: fromGit === undefined ? 'walk' : 'git',
    };
  }

  // The journal: one JSON file per unsaved buffer, named by a hash of its path, written whole and renamed into
  // place so a crash never leaves half an entry.
  const entryFile = (shown: string) =>
    join(journalRoot, `${createHash('sha256').update(shown).digest('hex')}.json`);

  async function readEntry(file: string): Promise<StoredEntry | undefined> {
    try {
      return parseStored(await readFile(file, 'utf8'));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function journalFiles(): Promise<string[]> {
    try {
      return (await readdir(journalRoot)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  /** The project-relative path for a journal request: inside the project, never a secret file. */
  async function journalPath(path: string): Promise<string> {
    const { target, shown } = await locate(path);
    if (target === (await projectRoot()))
      throw new AgentProblem('is_a_directory', 'Give a file’s path.');
    if (isSecretFile(basename(target))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    return shown;
  }

  async function journalPut(
    path: string,
    content: string,
    baseVersion: Version | null,
    revision: number,
  ): Promise<Results['journal-put']> {
    const shown = await journalPath(path);
    if (Buffer.byteLength(content, 'utf8') > LIMITS.fileBytes)
      throw new AgentProblem('too_large', 'Keep files under 1 MB.');
    const file = entryFile(shown);
    return oneAtATime(`journal:${file}`, async () => {
      const existing = await readEntry(file);
      // A put that arrives late never replaces newer edits.
      if (existing !== undefined && existing.revision > revision)
        return { path: shown, revision: existing.revision };
      if (existing === undefined && (await journalFiles()).length >= LIMITS.journalEntries) {
        throw new AgentProblem(
          'too_large',
          'Too many unsaved files. Save or close some, then try again.',
        );
      }
      const entry: StoredEntry = { path: shown, baseVersion, revision, updatedAt: now(), content };
      await mkdir(journalRoot, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
      await rename(temporary, file);
      return { path: shown, revision };
    });
  }

  const summary = (entry: StoredEntry): JournalSummary => ({
    path: entry.path,
    baseVersion: entry.baseVersion,
    revision: entry.revision,
    updatedAt: entry.updatedAt,
    size: Buffer.byteLength(entry.content, 'utf8'),
  });

  async function journalList(): Promise<Results['journal-list']> {
    const entries: JournalSummary[] = [];
    for (const name of await journalFiles()) {
      const entry = await readEntry(join(journalRoot, name));
      // Only entries stored under their own path's name (a renamed or damaged file is skipped).
      if (entry !== undefined && entryFile(entry.path) === join(journalRoot, name))
        entries.push(summary(entry));
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { entries };
  }

  async function journalGet(path: string): Promise<Results['journal-get']> {
    const shown = await journalPath(path);
    const entry = await readEntry(entryFile(shown));
    if (entry?.path !== shown)
      throw new AgentProblem('not_found', 'There are no unsaved changes for that file.');
    return { ...summary(entry), content: entry.content };
  }

  async function journalDrop(path: string, revision: number): Promise<Results['journal-drop']> {
    const shown = await journalPath(path);
    const file = entryFile(shown);
    return oneAtATime(`journal:${file}`, async () => {
      const entry = await readEntry(file);
      // Edits made after the save that asked for this stay in the journal.
      if (entry === undefined || entry.revision > revision) return { path: shown, dropped: false };
      await rm(file, { force: true });
      return { path: shown, dropped: true };
    });
  }

  async function exec(
    command: readonly string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<Results['exec']> {
    const { target } = await locate(cwd);
    const directory = await real(target);
    if (!(await lstat(directory)).isDirectory())
      throw new AgentProblem('not_a_directory', 'Run it in a folder.');
    const [program = '', ...args] = command;
    const started = Date.now();
    return new Promise((done, fail) => {
      // No shell: the command is a list of arguments, so nothing in it is interpreted. Its own process group,
      // so a time-out stops everything it started.
      const child = spawn(program, args, {
        cwd: directory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = {
        stdout: [] as Buffer[],
        stderr: [] as Buffer[],
        sizes: { stdout: 0, stderr: 0 },
      };
      let truncated = false;
      let timedOut = false;
      for (const stream of ['stdout', 'stderr'] as const) {
        child[stream].on('data', (chunk: Buffer) => {
          const room = LIMITS.execOutputBytes - output.sizes[stream];
          if (chunk.length > room) truncated = true;
          if (room > 0) {
            output[stream].push(chunk.subarray(0, room));
            output.sizes[stream] += Math.min(room, chunk.length);
          }
        });
      }
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        fail(
          errorCode(error) === 'ENOENT'
            ? new AgentProblem(
                'not_found',
                `There’s no program called ${program.slice(0, 100)} here.`,
              )
            : error,
        );
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        done({
          exitCode,
          signal,
          stdout: Buffer.concat(output.stdout).toString('utf8'),
          stderr: Buffer.concat(output.stderr).toString('utf8'),
          truncated,
          timedOut,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  return {
    handle(request) {
      switch (request.op) {
        case 'hello':
          return Promise.resolve({ protocol: AGENT_PROTOCOL, node: process.version });
        case 'list':
          return list(request.path);
        case 'read':
          return read(request.path);
        case 'write':
          return write(request.path, request.content, request.encoding, request.baseVersion);
        case 'exec':
          return exec(request.command, request.cwd, request.timeoutMs);
        case 'files':
          return files();
        case 'journal-put':
          return journalPut(request.path, request.content, request.baseVersion, request.revision);
        case 'journal-list':
          return journalList();
        case 'journal-get':
          return journalGet(request.path);
        case 'journal-drop':
          return journalDrop(request.path, request.revision);
      }
    },
  };
}

/** Answers one request; every failure becomes an error response with a sentence that's safe to show. */
export async function answer(agent: Agent, body: unknown): Promise<AgentResponse> {
  try {
    return { ok: true, result: await agent.handle(parseAgentRequest(body)) };
  } catch (error) {
    if (error instanceof AgentProblem)
      return { ok: false, error: { code: error.code, message: error.message } };
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        error: { code: 'not_allowed', message: 'The workspace isn’t allowed to do that.' },
      };
    }
    return {
      ok: false,
      error: { code: 'failed', message: 'That didn’t work in the workspace. Try again.' },
    };
  }
}

/** Reads requests line by line and writes each response as a line, in whatever order they finish. */
export function serve(agent: Agent, input: Readable, output: Writable): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const send = (envelope: Envelope<AgentResponse>) => output.write(`${JSON.stringify(envelope)}\n`);
  lines.on('line', (line) => {
    let id = 0;
    void (async () => {
      let body: unknown;
      try {
        if (line.length > LIMITS.lineBytes)
          throw new AgentProblem('too_large', 'That request is too large.');
        const envelope = JSON.parse(line) as Partial<Envelope<unknown>>;
        id = typeof envelope.id === 'number' && Number.isSafeInteger(envelope.id) ? envelope.id : 0;
        if (envelope.v !== AGENT_PROTOCOL) {
          throw new AgentProblem(
            'invalid_request',
            `This agent speaks protocol ${String(AGENT_PROTOCOL)}.`,
          );
        }
        body = envelope.body;
      } catch (error) {
        const message =
          error instanceof AgentProblem ? error.message : 'Send one JSON message per line.';
        send({
          v: AGENT_PROTOCOL,
          id,
          body: { ok: false, error: { code: 'invalid_request', message } },
        });
        return;
      }
      send({ v: AGENT_PROTOCOL, id, body: await answer(agent, body) });
    })();
  });
  return new Promise((done) => lines.on('close', done));
}
