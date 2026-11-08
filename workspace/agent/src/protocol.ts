// The workspace agent's protocol (phase 1d step 5; version 2 in phase 3 step 2): one JSON message per line over
// the agent's stdin and stdout, through the workspace host. Shared by the agent, the host and the control plane,
// so it has no imports and no Node APIs: the control plane bundles it into its Worker.

/** 2 (phase 3): versions on read and write, conflict-safe writes, the file list and the journal. The host copies
 * the agent into the workspace on every connection, so both sides always match. */
export const AGENT_PROTOCOL = 2;

/** Everything the API can see or change lives under this folder: the project's clone. */
export const PROJECT_ROOT = '/workspace/project';

/** Unsaved editor buffers (phase 3): in the workspace's volume, outside the project, so git, the dev server and
 * the file list never see them. */
export const JOURNAL_ROOT = '/workspace/.flowcanvas/journal';

/** Folders the file list and the watcher skip: dependencies, git's own data and build output. Watching
 * node_modules alone can take tens of thousands of inotify watches (ADR 0021). */
export const IGNORED_DIRECTORIES: readonly string[] = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
];

export const LIMITS = {
  /** Longest path, in characters. */
  pathLength: 1024,
  /** Largest file read or written through the API; bigger ones are for the editor's streaming (phase 3). */
  fileBytes: 1024 * 1024,
  /** Most entries a listing returns. */
  entries: 5000,
  /** Most paths the file list returns. */
  files: 50_000,
  /** Most unsaved buffers kept in the journal. */
  journalEntries: 500,
  /** Longest a command may run, and the default. */
  execTimeoutMs: 120_000,
  execDefaultTimeoutMs: 30_000,
  /** Output kept from each of stdout and stderr. */
  execOutputBytes: 1024 * 1024,
  execArgs: 256,
  execArgLength: 32 * 1024,
  /** Largest message line either side accepts (a 1 MiB file as base64, plus room). */
  lineBytes: 2 * 1024 * 1024,
} as const;

export type AgentRequest =
  | { readonly op: 'hello' }
  | { readonly op: 'list'; readonly path: string }
  | { readonly op: 'read'; readonly path: string }
  | {
      readonly op: 'write';
      readonly path: string;
      readonly content: string;
      readonly encoding: Encoding;
      /** The version this content was edited from: refused with `conflict` if the file changed meanwhile. `null`:
       * the file must not exist yet. Absent: write whatever is there (phase 1d behaviour). */
      readonly baseVersion?: Version | null;
    }
  | { readonly op: 'files' }
  | {
      readonly op: 'journal-put';
      readonly path: string;
      readonly content: string;
      /** The file's version the buffer was edited from; `null` for a file that doesn't exist yet. */
      readonly baseVersion: Version | null;
      /** Rises with every edit of the buffer; an older put never replaces a newer one. */
      readonly revision: number;
    }
  | { readonly op: 'journal-list' }
  | { readonly op: 'journal-get'; readonly path: string }
  | {
      readonly op: 'journal-drop';
      readonly path: string;
      /** Drops the entry only if it's no newer than this, so edits made after a save are kept. */
      readonly revision: number;
    }
  | {
      readonly op: 'exec';
      readonly command: readonly string[];
      readonly cwd: string;
      readonly timeoutMs: number;
    };

export type Encoding = 'utf8' | 'base64';

/** A file's version: the SHA-256 of its bytes, as 64 hex digits. */
export type Version = string;
const VERSION = /^[0-9a-f]{64}$/;

export interface Entry {
  readonly name: string;
  readonly type: 'file' | 'directory' | 'symlink' | 'other';
  readonly size: number;
  /** A .env-style file: listed, never read or written through the API (CLAUDE.md rule 5). */
  readonly secret: boolean;
}

export interface Results {
  readonly hello: { readonly protocol: number; readonly node: string };
  readonly list: {
    readonly path: string;
    readonly entries: readonly Entry[];
    readonly truncated: boolean;
  };
  readonly read: {
    readonly path: string;
    readonly size: number;
    readonly encoding: Encoding;
    readonly content: string;
    readonly version: Version;
  };
  readonly write: { readonly path: string; readonly size: number; readonly version: Version };
  readonly files: {
    /** Project-relative paths of files, sorted; never secret files. */
    readonly files: readonly string[];
    readonly truncated: boolean;
    /** `git`: tracked and untracked, not ignored. `walk`: not a git repository, so every folder but the ignored. */
    readonly source: 'git' | 'walk';
  };
  readonly 'journal-put': { readonly path: string; readonly revision: number };
  readonly 'journal-list': { readonly entries: readonly JournalSummary[] };
  readonly 'journal-get': JournalSummary & { readonly content: string };
  readonly 'journal-drop': { readonly path: string; readonly dropped: boolean };
  readonly exec: {
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
    readonly timedOut: boolean;
    readonly durationMs: number;
  };
}

export interface JournalSummary {
  readonly path: string;
  readonly baseVersion: Version | null;
  readonly revision: number;
  /** When the agent stored it (ms since the epoch, the workspace's clock). */
  readonly updatedAt: number;
  readonly size: number;
}

export type AgentResult = Results[keyof Results];

export const ERROR_CODES = [
  'invalid_request',
  'not_found',
  'not_a_directory',
  'is_a_directory',
  'outside_project',
  'secret_file',
  'too_large',
  'not_allowed',
  /** A conflict-safe write found a different version on disk than the one it was edited from. */
  'conflict',
  'failed',
] as const;
export type AgentErrorCode = (typeof ERROR_CODES)[number];

export type AgentResponse =
  | { readonly ok: true; readonly result: AgentResult }
  | {
      readonly ok: false;
      readonly error: { readonly code: AgentErrorCode; readonly message: string };
    };

/** One line on the wire. `id` matches a response to its request. */
export interface Envelope<T> {
  readonly v: typeof AGENT_PROTOCOL;
  readonly id: number;
  readonly body: T;
}

/** A sentence-sized error, ready to show. */
export class AgentProblem extends Error {
  override readonly name = 'AgentProblem';
  readonly code: AgentErrorCode;
  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** `.env`, `.env.local`, `.dev.vars`… but not `.env.example`, `.env.sample` or `.env.template`. */
export function isSecretFile(name: string): boolean {
  return /^(\.env|\.dev\.vars)(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name);
}

function checkPath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string') throw new AgentProblem('invalid_request', `Give a ${field}.`);
  if (value.length > LIMITS.pathLength)
    throw new AgentProblem('invalid_request', 'That path is too long.');
  if (value.includes('\0')) throw new AgentProblem('invalid_request', 'That path isn’t valid.');
  if (value.startsWith('/')) {
    throw new AgentProblem('outside_project', 'Use a path inside the project, like src/index.ts.');
  }
  return value;
}

function checkVersion(value: unknown, field: string): Version | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !VERSION.test(value)) {
    throw new AgentProblem('invalid_request', `The ${field} must be a file version or null.`);
  }
  return value;
}

function checkRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentProblem('invalid_request', 'The revision must be a whole number.');
  }
  return value;
}

function checkText(value: unknown): string {
  if (typeof value !== 'string')
    throw new AgentProblem('invalid_request', 'Give the content as text.');
  // A quick bound; the agent checks the exact size in bytes.
  if (value.length > LIMITS.fileBytes)
    throw new AgentProblem('too_large', 'Keep files under 1 MB.');
  return value;
}

/** Checks an untrusted request (from the browser, through the control plane) before anything acts on it. */
export function parseAgentRequest(input: unknown): AgentRequest {
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  switch (fields.op) {
    case 'hello':
      return { op: 'hello' };
    case 'list':
      return { op: 'list', path: checkPath(fields.path ?? '') };
    case 'read':
      return { op: 'read', path: checkPath(fields.path) };
    case 'write': {
      const path = checkPath(fields.path);
      const encoding = fields.encoding ?? 'utf8';
      if (encoding !== 'utf8' && encoding !== 'base64') {
        throw new AgentProblem('invalid_request', 'The encoding must be utf8 or base64.');
      }
      if (typeof fields.content !== 'string') {
        throw new AgentProblem('invalid_request', 'Give the file’s content as text.');
      }
      // A quick bound before decoding (every UTF-16 unit is at least a byte; base64 is 4 characters per 3
      // bytes); the agent checks the exact size.
      const most = encoding === 'base64' ? Math.ceil(LIMITS.fileBytes / 3) * 4 : LIMITS.fileBytes;
      if (fields.content.length > most) {
        throw new AgentProblem('too_large', 'Keep files under 1 MB.');
      }
      return {
        op: 'write',
        path,
        content: fields.content,
        encoding,
        ...(fields.baseVersion === undefined
          ? {}
          : { baseVersion: checkVersion(fields.baseVersion, 'base version') }),
      };
    }
    case 'files':
      return { op: 'files' };
    case 'journal-put':
      return {
        op: 'journal-put',
        path: checkPath(fields.path),
        content: checkText(fields.content),
        baseVersion: checkVersion(fields.baseVersion ?? null, 'base version'),
        revision: checkRevision(fields.revision),
      };
    case 'journal-list':
      return { op: 'journal-list' };
    case 'journal-get':
      return { op: 'journal-get', path: checkPath(fields.path) };
    case 'journal-drop':
      return {
        op: 'journal-drop',
        path: checkPath(fields.path),
        revision: checkRevision(fields.revision),
      };
    case 'exec': {
      const command = fields.command;
      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        command.length > LIMITS.execArgs ||
        !command.every(
          (arg): arg is string =>
            typeof arg === 'string' && arg.length <= LIMITS.execArgLength && !arg.includes('\0'),
        ) ||
        command[0] === ''
      ) {
        throw new AgentProblem(
          'invalid_request',
          'Give the command as a list, like ["git", "status"].',
        );
      }
      const timeoutMs = fields.timeoutMs ?? LIMITS.execDefaultTimeoutMs;
      if (
        typeof timeoutMs !== 'number' ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > LIMITS.execTimeoutMs
      ) {
        throw new AgentProblem('invalid_request', 'The time limit must be 1 ms to 2 minutes.');
      }
      return { op: 'exec', command, cwd: checkPath(fields.cwd ?? '', 'cwd'), timeoutMs };
    }
    default:
      throw new AgentProblem('invalid_request', 'Unknown operation.');
  }
}

/** Checks an untrusted response (from inside the workspace) before it's passed on. */
export function isAgentResponse(value: unknown): value is AgentResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as {
    ok?: unknown;
    result?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  if (response.ok === true) return typeof response.result === 'object' && response.result !== null;
  return (
    response.ok === false &&
    typeof response.error?.message === 'string' &&
    response.error.message.length <= 300 &&
    (ERROR_CODES as readonly unknown[]).includes(response.error.code)
  );
}

// The watcher (phase 3 step 3): `main.js --watch` prints one event per line while it runs, and the host relays
// them to the page. Paths are project-relative, never secret files, never inside the ignored folders.

export const WATCH_LIMITS = {
  /** Changes to one path within this long are reported once. */
  coalesceMs: 50,
  /** More changed paths than this at once (a git checkout, an install) become one `overflow`. */
  pending: 500,
  /** Folders watched at most: each takes one inotify watch from a pool the whole computer shares. */
  folders: 20_000,
} as const;

export type WatchEvent =
  /** Watching has started: how many folders and files it covers. */
  | { readonly type: 'ready'; readonly folders: number; readonly files: number }
  /**
   * A file was created, changed or deleted. `version` is its new version, or null when it's deleted or too
   * large to read (over 1 MB).
   */
  | {
      readonly type: 'changed';
      readonly path: string;
      readonly deleted: boolean;
      readonly version: Version | null;
    }
  /** Too much changed at once to list: reload the file list and re-check open files. */
  | { readonly type: 'overflow' }
  /** Watching stopped or can't cover everything; a sentence that's safe to show. */
  | { readonly type: 'error'; readonly message: string };

/** Checks an event from inside the workspace (untrusted) before it's passed on; undefined if it isn't one. */
export function parseWatchEvent(value: unknown): WatchEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case 'ready':
      return Number.isSafeInteger(event.folders) && Number.isSafeInteger(event.files)
        ? { type: 'ready', folders: event.folders as number, files: event.files as number }
        : undefined;
    case 'changed': {
      const path = event.path;
      const version = event.version;
      if (
        typeof path !== 'string' ||
        path === '' ||
        path.length > LIMITS.pathLength ||
        path.startsWith('/') ||
        path.includes('\0') ||
        path
          .split('/')
          .some((part) => part === '..' || part === '' || IGNORED_DIRECTORIES.includes(part)) ||
        isSecretFile(path.split('/').pop() ?? '') ||
        typeof event.deleted !== 'boolean' ||
        !(version === null || (typeof version === 'string' && VERSION.test(version))) ||
        (event.deleted && version !== null)
      ) {
        return undefined;
      }
      return { type: 'changed', path, deleted: event.deleted, version };
    }
    case 'overflow':
      return { type: 'overflow' };
    case 'error':
      return typeof event.message === 'string' && event.message.length <= 300
        ? { type: 'error', message: event.message }
        : undefined;
    default:
      return undefined;
  }
}
