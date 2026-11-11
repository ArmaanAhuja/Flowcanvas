// The engine's protocol (phase 4 step 3, ADR 0025): one JSON message per line over the engine process's stdin
// and stdout, through the workspace host, like the agent's (ADR 0016). Shared by the engine, the host and the
// control plane, so it has no imports and no Node APIs: the control plane bundles it into its Worker.

export const ENGINE_PROTOCOL = 1;

/** Inside the workspace: where the host copies the engine. /tmp is a tmpfs, so a new container gets a fresh copy. */
export const ENGINE_HOME = '/tmp/flowcanvas-engine';
/** The index: in the workspace's volume (it survives sleep and restarts), outside the project. */
export const INDEX_FILE = '/workspace/.flowcanvas/index.db';

export const ENGINE_LIMITS = {
  /** Longest search, in characters. */
  query: 100,
  /** Most results a search returns, and the default. */
  results: 100,
  defaultResults: 50,
  /** Largest message line either side accepts: 100 results of long paths and names, with room. */
  lineBytes: 256 * 1024,
  /** Longest name, path or container passed on (longer ones are cut, never dropped). */
  text: 1024,
} as const;

export const SYMBOL_KIND_NAMES = [
  'function',
  'component',
  'class',
  'method',
  'interface',
  'type',
  'enum',
  'constant',
  'namespace',
  'heading',
] as const;
export type SymbolKindName = (typeof SYMBOL_KIND_NAMES)[number];

export const FILE_STATUSES = ['parsed', 'no-grammar', 'too-large', 'binary', 'unreadable'] as const;
export type FileStatusName = (typeof FILE_STATUSES)[number];

export type EngineRequest =
  | { readonly op: 'hello' }
  | { readonly op: 'status' }
  | { readonly op: 'search'; readonly query: string; readonly limit: number };

/**
 * - `starting`: the engine is opening its index and listing files.
 * - `indexing`: a full pass is running (`done` of `total`).
 * - `ready`: the index matches the files; changes are re-indexed as they happen.
 * - `failed`: indexing stopped; `message` says why, in words that are safe to show.
 */
export const ENGINE_STATES = ['starting', 'indexing', 'ready', 'failed'] as const;
export type EngineState = (typeof ENGINE_STATES)[number];

export interface EngineStatus {
  readonly state: EngineState;
  readonly done: number;
  readonly total: number;
  /** Every file listed, by what happened to it. */
  readonly files: number;
  readonly byStatus: Readonly<Record<FileStatusName, number>>;
  readonly symbols: number;
  readonly withSyntaxErrors: number;
  /** Parsed, but not all of it read (MDX components). */
  readonly partlyRead: number;
  /** How long the last full pass took, or null before the first one ends. */
  readonly lastFullMs: number | null;
  readonly message: string | null;
}

export interface SymbolHit {
  readonly path: string;
  readonly name: string;
  readonly kind: SymbolKindName;
  readonly container: string | null;
  readonly line: number;
  readonly column: number;
  readonly exported: boolean;
}

export interface SearchResult {
  readonly symbols: readonly SymbolHit[];
  /** The engine's own time for the query (the 100 ms target's first half). */
  readonly ms: number;
}

export interface EngineResults {
  readonly hello: { readonly protocol: number };
  readonly status: EngineStatus;
  readonly search: SearchResult;
}

export const ENGINE_ERROR_CODES = ['invalid_request', 'failed'] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export type EngineResponse =
  | { readonly ok: true; readonly result: EngineResults[keyof EngineResults] }
  | {
      readonly ok: false;
      readonly error: { readonly code: EngineErrorCode; readonly message: string };
    };

export interface EngineEnvelope<T> {
  readonly v: number;
  readonly id: number;
  readonly body: T;
}

export class EngineProblem extends Error {
  override readonly name = 'EngineProblem';
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Checks an untrusted request (from the browser, through the control plane) before anything acts on it. */
export function parseEngineRequest(input: unknown): EngineRequest {
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  switch (fields.op) {
    case 'hello':
      return { op: 'hello' };
    case 'status':
      return { op: 'status' };
    case 'search': {
      if (typeof fields.query !== 'string') {
        throw new EngineProblem('invalid_request', 'Give something to search for.');
      }
      if (fields.query.length > ENGINE_LIMITS.query) {
        throw new EngineProblem('invalid_request', 'Keep searches under 100 characters.');
      }
      const limit = fields.limit ?? ENGINE_LIMITS.defaultResults;
      if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > ENGINE_LIMITS.results
      ) {
        throw new EngineProblem('invalid_request', 'Ask for 1 to 100 results.');
      }
      return { op: 'search', query: fields.query, limit };
    }
    default:
      throw new EngineProblem('invalid_request', 'Unknown operation.');
  }
}

// Checking answers from inside the workspace, which is untrusted: exact shapes and bounded sizes only.

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= ENGINE_LIMITS.text;
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function isStatus(value: unknown): value is EngineStatus {
  const s = record(value);
  const byStatus = record(s?.byStatus);
  return (
    s !== undefined &&
    byStatus !== undefined &&
    (ENGINE_STATES as readonly unknown[]).includes(s.state) &&
    [s.done, s.total, s.files, s.symbols, s.withSyntaxErrors, s.partlyRead].every(isCount) &&
    FILE_STATUSES.every((status) => isCount(byStatus[status])) &&
    Object.keys(byStatus).length === FILE_STATUSES.length &&
    (s.lastFullMs === null || isCount(s.lastFullMs)) &&
    (s.message === null || (typeof s.message === 'string' && s.message.length <= 300))
  );
}

function isHit(value: unknown): value is SymbolHit {
  const h = record(value);
  return (
    h !== undefined &&
    isText(h.path) &&
    !h.path.startsWith('/') &&
    isText(h.name) &&
    (SYMBOL_KIND_NAMES as readonly unknown[]).includes(h.kind) &&
    (h.container === null || isText(h.container)) &&
    isCount(h.line) &&
    h.line >= 1 &&
    isCount(h.column) &&
    h.column >= 1 &&
    typeof h.exported === 'boolean'
  );
}

/** Checks an untrusted response to `request` (from inside the workspace) before it's passed on. */
export function isEngineResponse(request: EngineRequest, value: unknown): value is EngineResponse {
  const response = record(value);
  if (response === undefined) return false;
  if (response.ok === false) {
    const error = record(response.error);
    return (
      error !== undefined &&
      (ENGINE_ERROR_CODES as readonly unknown[]).includes(error.code) &&
      typeof error.message === 'string' &&
      error.message.length <= 300
    );
  }
  if (response.ok !== true) return false;
  const result = record(response.result);
  switch (request.op) {
    case 'hello':
      return isCount(result?.protocol);
    case 'status':
      return isStatus(result);
    case 'search':
      return (
        result !== undefined &&
        isCount(result.ms) &&
        Array.isArray(result.symbols) &&
        result.symbols.length <= request.limit &&
        result.symbols.every(isHit)
      );
  }
}
