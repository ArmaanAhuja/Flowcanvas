// The workspace agent's protocol (phase 1d step 5): one JSON message per line over the agent's stdin and
// stdout, through the workspace host. Shared by the agent, the host and the control plane, so it has no
// imports and no Node APIs: the control plane bundles it into its Worker.

export const AGENT_PROTOCOL = 1;

/** Everything the API can see or change lives under this folder: the project's clone. */
export const PROJECT_ROOT = '/workspace/project';

export const LIMITS = {
  /** Longest path, in characters. */
  pathLength: 1024,
  /** Largest file read or written through the API; bigger ones are for the editor's streaming (phase 3). */
  fileBytes: 1024 * 1024,
  /** Most entries a listing returns. */
  entries: 5000,
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
    }
  | {
      readonly op: 'exec';
      readonly command: readonly string[];
      readonly cwd: string;
      readonly timeoutMs: number;
    };

export type Encoding = 'utf8' | 'base64';

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
  };
  readonly write: { readonly path: string; readonly size: number };
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
      return { op: 'write', path, content: fields.content, encoding };
    }
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
