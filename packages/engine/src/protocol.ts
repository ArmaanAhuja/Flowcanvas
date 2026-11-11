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
  | { readonly op: 'search'; readonly query: string; readonly limit: number }
  | ({ readonly op: SemanticOp } & CodePosition);

// TypeScript semantics (phase 5, ADR 0026): questions about the name at a place in a file.
export const SEMANTIC_OPS = ['definition', 'references', 'callers', 'callees'] as const;
export type SemanticOp = (typeof SEMANTIC_OPS)[number];

/** A place in the project: a project-relative path, a 1-based line and a 1-based column in UTF-16 units. */
export interface CodePosition {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

/**
 * How a caller or callee is known (CLAUDE.md rule 4): `resolved` when the compiler proved it; `unresolved` when it
 * couldn't (a package without types, `obj[key]()`), shown with the call's text and never guessed.
 */
export const PROVENANCES = ['resolved', 'unresolved'] as const;
export type Provenance = (typeof PROVENANCES)[number];
/** A plain call, or a component rendered (`<PollForm />`, owner, 12 Nov 2026). */
export const RELATIONS = ['calls', 'renders'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Something a question is about or found: a function, method, component, class… */
export interface CodeItem {
  /** Its name; for an unresolved callee, the call's text (cut to 120 characters). */
  readonly name: string;
  readonly kind: SymbolKindName | null;
  readonly container: string | null;
  /** Where it's declared; null when it's unresolved, or built in (TypeScript's standard library). */
  readonly place: CodePosition | null;
  /** From TypeScript's standard library (`Math.max`, `Promise.all`): resolved, but not the project's code. */
  readonly builtIn: boolean;
}

export interface CallEntry extends CodeItem {
  readonly relation: Relation;
  readonly provenance: Provenance;
  /** Where the calls happen: in the caller (for callers), or in the function asked about (for callees). */
  readonly sites: readonly CodePosition[];
}

export interface CallsResult {
  /** What was asked about, or null when there's nothing callable there. */
  readonly target: CodeItem | null;
  readonly entries: readonly CallEntry[];
  /** False when some of the project couldn't be looked at (too large, or a limit was reached): said in `message`. */
  readonly complete: boolean;
  readonly message: string | null;
}

export interface DefinitionResult {
  readonly definitions: readonly CodeItem[];
  readonly message: string | null;
}

export interface ReferencesResult {
  readonly target: CodeItem | null;
  readonly references: readonly (CodePosition & { readonly isDefinition: boolean })[];
  readonly complete: boolean;
  readonly message: string | null;
}

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
  readonly definition: DefinitionResult;
  readonly references: ReferencesResult;
  readonly callers: CallsResult;
  readonly callees: CallsResult;
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
    case 'definition':
    case 'references':
    case 'callers':
    case 'callees': {
      const { path, line, column } = fields;
      if (
        typeof path !== 'string' ||
        path === '' ||
        path.length > ENGINE_LIMITS.text ||
        path.startsWith('/') ||
        path.split('/').some((part) => part === '..' || part === '')
      ) {
        throw new EngineProblem(
          'invalid_request',
          'Give a file in the project, like src/index.ts.',
        );
      }
      if (!isPositive(line) || !isPositive(column)) {
        throw new EngineProblem('invalid_request', 'Give a line and a column, counting from 1.');
      }
      return { op: fields.op, path, line, column };
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
    case 'definition':
      return (
        result !== undefined &&
        isList(result.definitions, SEMANTIC_LIMITS.definitions, isItem) &&
        isMessage(result.message)
      );
    case 'references':
      return (
        result !== undefined &&
        (result.target === null || isItem(result.target)) &&
        isList(
          result.references,
          SEMANTIC_LIMITS.references,
          (r) => isPosition(r) && typeof record(r)?.isDefinition === 'boolean',
        ) &&
        typeof result.complete === 'boolean' &&
        isMessage(result.message)
      );
    case 'callers':
    case 'callees':
      return (
        result !== undefined &&
        (result.target === null || isItem(result.target)) &&
        isList(result.entries, SEMANTIC_LIMITS.entries, isEntry) &&
        typeof result.complete === 'boolean' &&
        isMessage(result.message)
      );
  }
}

/** The most a semantic answer holds; the engine says when it stopped short (`complete: false`). */
export const SEMANTIC_LIMITS = {
  definitions: 20,
  references: 500,
  entries: 200,
  sites: 50,
} as const;

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const isMessage = (value: unknown) =>
  value === null || (typeof value === 'string' && value.length <= 300);
const isList = (value: unknown, most: number, each: (item: unknown) => boolean) =>
  Array.isArray(value) && value.length <= most && value.every(each);

function isPosition(value: unknown): value is CodePosition {
  const p = record(value);
  return (
    p !== undefined &&
    isText(p.path) &&
    !p.path.startsWith('/') &&
    !p.path.split('/').includes('..') &&
    isPositive(p.line) &&
    isPositive(p.column)
  );
}

function isItem(value: unknown): value is CodeItem {
  const i = record(value);
  return (
    i !== undefined &&
    isText(i.name) &&
    (i.kind === null || (SYMBOL_KIND_NAMES as readonly unknown[]).includes(i.kind)) &&
    (i.container === null || isText(i.container)) &&
    (i.place === null || isPosition(i.place)) &&
    typeof i.builtIn === 'boolean'
  );
}

function isEntry(value: unknown): value is CallEntry {
  const e = record(value);
  return (
    e !== undefined &&
    isItem(e) &&
    (RELATIONS as readonly unknown[]).includes(e.relation) &&
    (PROVENANCES as readonly unknown[]).includes(e.provenance) &&
    isList(e.sites, SEMANTIC_LIMITS.sites, isPosition) &&
    // Unresolved means not proven: never a place to jump to as if it were.
    (e.provenance === 'resolved' || e.place === null)
  );
}
