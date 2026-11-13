// The engine's protocol (phase 4 step 3, ADR 0025): one JSON message per line over the engine process's stdin
// and stdout, through the workspace host, like the agent's (ADR 0016). Shared by the engine, the host and the
// control plane, so it has no Node APIs: the control plane bundles it into its Worker. Its one import is the graph
// model's vocabulary (plain data, phase 6), so the graph's kinds are named in one place.
import {
  CHANGE_STATES,
  CODE_UNIT_KINDS,
  EDGE_KINDS,
  FLOW_LIMITS,
  FLOW_MAX_NODES,
  NODE_KINDS,
  PROVENANCES as GRAPH_PROVENANCES,
  RELATIONS as GRAPH_RELATIONS,
  type CodeUnitKind,
  type Flow,
  type GraphStats,
} from '@flowcanvas/graph-model';

export const ENGINE_PROTOCOL = 1;

/** Inside the workspace: where the host copies the engine. /tmp is a tmpfs, so a new container gets a fresh copy. */
export const ENGINE_HOME = '/tmp/flowcanvas-engine';
/** The index: in the workspace's volume (it survives sleep and restarts), outside the project. */
export const INDEX_FILE = '/workspace/.flowcanvas/index.db';
/** The flow graph's versions (phase 6, ADR 0027): beside the index, in a file of its own so a rebuilt index keeps them. */
export const GRAPH_FILE = '/workspace/.flowcanvas/graph.db';
/** Each file's code units and their details, from the graph pass (phase 7): read instead of asking TypeScript. */
export const FACTS_FILE = '/workspace/.flowcanvas/facts.db';

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
  | { readonly op: 'graph' }
  | { readonly op: 'search'; readonly query: string; readonly limit: number }
  | ({ readonly op: SemanticOp } & CodePosition)
  /** A flow from the code unit at a place (phase 7, ADR 0028). */
  | ({ readonly op: 'flow' } & CodePosition);

// TypeScript semantics (phase 5, ADR 0026): questions about the name at a place in a file.
export const SEMANTIC_OPS = ['definition', 'references', 'callers', 'callees', 'details'] as const;
export type SemanticOp = (typeof SEMANTIC_OPS)[number];
/**
 * What may wait on TypeScript, whose first answer about a package builds its programs (seconds): its questions, and
 * a flow opened from inside a function (phase 7). Given the longer timeouts.
 */
export const TYPESCRIPT_OPS: readonly EngineRequest['op'][] = [...SEMANTIC_OPS, 'flow'];

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

/** Said when part of the project couldn't be looked at. */
export const PARTLY = {
  memory: 'Part of this project is too large to look at here, so some callers may be missing.',
  limit: 'Showing the first results only.',
} as const;

/** An entry as the protocol sends it. */
export const plainEntry = (entry: CallEntry): CallEntry => ({
  name: entry.name,
  kind: entry.kind,
  container: entry.container,
  place: entry.place,
  builtIn: entry.builtIn,
  relation: entry.relation,
  provenance: entry.provenance,
  sites: entry.sites,
});

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

/**
 * The flow graph's state (phase 6, ADR 0027):
 * - `waiting`: the index isn't ready yet; the graph is built after it.
 * - `building`: a pass is running (`snapshot` is the last one, if any).
 * - `ready`: `snapshot` is up to date with the files.
 * - `failed`: the last pass couldn't finish; `message` says why (`snapshot` is the last good one, if any).
 */
export const GRAPH_STATES = ['waiting', 'building', 'ready', 'failed'] as const;
export type GraphState = (typeof GRAPH_STATES)[number];

/** What Graph stats shows about one snapshot: counts by kind (every kind, zeros included) and its timings. */
export interface GraphSnapshotInfo {
  /** The SHA-256 of its encoding. */
  readonly version: string;
  readonly takenAt: string;
  readonly complete: boolean;
  readonly note: string | null;
  readonly files: number;
  readonly builtInCalls: number;
  readonly stats: GraphStats;
  /** How long the pass took; and saving and loading the snapshot (the Done when's "under 1 s"). */
  readonly buildMs: number;
  readonly saveMs: number;
  readonly loadMs: number;
}

export interface GraphStatus {
  readonly state: GraphState;
  readonly message: string | null;
  readonly snapshot: GraphSnapshotInfo | null;
}

/**
 * A flow (phase 7, ADR 0028), from the latest version of the graph. `flow` is null when there's none to show, and
 * `message` says why; with a flow, `message` says what to know about it (shown smaller to fit).
 */
export interface FlowResult {
  readonly flow: Flow | null;
  readonly message: string | null;
  /** The version it's from (its SHA-256) and when that was taken; null when there's no version yet. */
  readonly version: string | null;
  readonly takenAt: string | null;
  /** False while the graph is being brought up to date with the files: the flow is from the last version. */
  readonly current: boolean;
  /** False when that version covers part of the project only. */
  readonly complete: boolean;
}

/** What the inspector shows of a code unit (phase 7, ADR 0028 §3): each list's first items, and how many in all. */
export const DETAIL_LIMITS = { items: 50, params: 30, outcomes: 30, text: 300 } as const;
export const DECISION_KINDS = ['if', 'switch', 'ternary', 'catch'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** Something at a line of the unit's file: a thrown error, an awaited call, a write. */
export interface DetailLine {
  readonly text: string;
  readonly line: number;
}

export interface DetailList<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export interface DetailDecision {
  readonly kind: DecisionKind;
  /** The condition as written (a switch's: the switched expression; a catch's: "on error"). */
  readonly condition: string;
  /** "yes" and "no" ("yes" alone without an else), each case, or "error". */
  readonly outcomes: readonly string[];
  readonly line: number;
}

export interface DetailParam {
  readonly name: string;
  /** Its type, as the compiler sees it. */
  readonly type: string;
  readonly optional: boolean;
}

export interface NodeDetails {
  /** Its node in the graph. */
  readonly id: string;
  readonly name: string;
  readonly unit: CodeUnitKind;
  /** Where its name is (a top level: line 1). */
  readonly place: CodePosition;
  /** `(poll: PollInput): Promise<Poll>`; null for a class or a top level. */
  readonly signature: string | null;
  readonly params: DetailList<DetailParam>;
  readonly returns: string | null;
  readonly async: boolean;
  readonly exported: boolean;
  readonly decisions: DetailList<DetailDecision>;
  readonly throws: DetailList<DetailLine>;
  readonly awaits: DetailList<DetailLine>;
  /** Calls whose target wasn't found, as written, with their lines (the flow's open stub). */
  readonly unresolved: DetailList<{ readonly text: string; readonly lines: readonly number[] }>;
  /** Assignments to variables declared at a file's top level (module state). */
  readonly writes: DetailList<DetailLine>;
}

export interface DetailsResult {
  readonly details: NodeDetails | null;
  /** Why there are none (not in a TypeScript or JavaScript file, or TypeScript couldn't answer). */
  readonly message: string | null;
}

export interface EngineResults {
  readonly hello: { readonly protocol: number };
  readonly status: EngineStatus;
  readonly graph: GraphStatus;
  readonly search: SearchResult;
  readonly definition: DefinitionResult;
  readonly references: ReferencesResult;
  readonly callers: CallsResult;
  readonly callees: CallsResult;
  readonly flow: FlowResult;
  readonly details: DetailsResult;
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
    case 'graph':
      return { op: 'graph' };
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
    case 'callees':
    case 'details':
    case 'flow': {
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

/** Exactly these keys, each a count. */
const isCounts = (value: unknown, keys: readonly string[]) => {
  const r = record(value);
  return (
    r !== undefined && Object.keys(r).length === keys.length && keys.every((key) => isCount(r[key]))
  );
};

function isGraphStatus(value: unknown): value is GraphStatus {
  const g = record(value);
  if (
    g === undefined ||
    !(GRAPH_STATES as readonly unknown[]).includes(g.state) ||
    !(g.message === null || (typeof g.message === 'string' && g.message.length <= 300))
  ) {
    return false;
  }
  if (g.snapshot === null) return true;
  const s = record(g.snapshot);
  const stats = record(s?.stats);
  return (
    s !== undefined &&
    stats !== undefined &&
    typeof s.version === 'string' &&
    /^[0-9a-f]{64}$/.test(s.version) &&
    typeof s.takenAt === 'string' &&
    !Number.isNaN(Date.parse(s.takenAt)) &&
    s.takenAt.length <= 40 &&
    typeof s.complete === 'boolean' &&
    (s.note === null || (typeof s.note === 'string' && s.note.length <= 300)) &&
    [s.files, s.builtInCalls, s.buildMs, s.saveMs, s.loadMs, stats.nodes, stats.edges].every(
      isCount,
    ) &&
    isCounts(stats.byNodeKind, NODE_KINDS) &&
    isCounts(stats.byCodeUnit, CODE_UNIT_KINDS) &&
    isCounts(stats.byEdgeKind, EDGE_KINDS) &&
    isCounts(stats.byProvenance, GRAPH_PROVENANCES) &&
    Object.keys(stats).length === 6
  );
}

const isLines = (value: unknown, sites: unknown) =>
  Array.isArray(value) &&
  value.length <= FLOW_LIMITS.lines &&
  value.every((line) => isCount(line) && line >= 1) &&
  isCount(sites) &&
  sites >= value.length;
const isLabel = (value: unknown) => value === null || isText(value);
const isRelation = (value: unknown) =>
  value === null || (GRAPH_RELATIONS as readonly unknown[]).includes(value);

function isFlowNode(value: unknown): boolean {
  const n = record(value);
  const place = n?.place === null ? null : record(n?.place);
  return (
    n !== undefined &&
    isText(n.id) &&
    (NODE_KINDS as readonly unknown[]).includes(n.kind) &&
    typeof n.name === 'string' &&
    n.name.length <= ENGINE_LIMITS.text &&
    (place === null ||
      (place !== undefined &&
        isText(place.path) &&
        !place.path.startsWith('/') &&
        isCount(place.line) &&
        place.line >= 1 &&
        isCount(place.column) &&
        place.column >= 1)) &&
    (n.unit === null || (CODE_UNIT_KINDS as readonly unknown[]).includes(n.unit)) &&
    (CHANGE_STATES as readonly unknown[]).includes(n.change)
  );
}

/** A flow: bounded, and every edge, group and cut between nodes it has. */
function isFlow(value: unknown): value is Flow {
  const f = record(value);
  if (
    f === undefined ||
    !Array.isArray(f.nodes) ||
    f.nodes.length < 1 ||
    f.nodes.length > FLOW_MAX_NODES ||
    !f.nodes.every(isFlowNode) ||
    !Array.isArray(f.edges) ||
    !Array.isArray(f.unknown) ||
    !Array.isArray(f.cut)
  ) {
    return false;
  }
  const ids = new Set((f.nodes as readonly { readonly id: string }[]).map((n) => n.id));
  const has = (id: unknown) => typeof id === 'string' && ids.has(id);
  return (
    ids.size === f.nodes.length &&
    has(f.root) &&
    f.edges.every((value) => {
      const e = record(value);
      return (
        e !== undefined &&
        has(e.from) &&
        has(e.to) &&
        (e.kind === 'call' || e.kind === 'branch') &&
        isRelation(e.relation) &&
        isLabel(e.label) &&
        (GRAPH_PROVENANCES as readonly unknown[]).includes(e.provenance) &&
        isLines(e.lines, e.sites)
      );
    }) &&
    f.unknown.length <= ids.size &&
    f.unknown.every((value) => {
      const g = record(value);
      return (
        g !== undefined &&
        has(g.from) &&
        Array.isArray(g.calls) &&
        g.calls.length <= FLOW_LIMITS.unknown &&
        isCount(g.total) &&
        g.total >= g.calls.length &&
        g.calls.every((call) => {
          const c = record(call);
          return (
            c !== undefined &&
            isText(c.target) &&
            isRelation(c.relation) &&
            isLabel(c.label) &&
            isLines(c.lines, c.sites)
          );
        })
      );
    }) &&
    f.cut.length <= ids.size &&
    f.cut.every((value) => {
      const c = record(value);
      return c !== undefined && has(c.from) && isCount(c.nodes) && c.nodes >= 1;
    }) &&
    isCount(f.hidden) &&
    isCounts(f.byProvenance, GRAPH_PROVENANCES)
  );
}

const isDetailText = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= DETAIL_LIMITS.text;
const isDetailList = (value: unknown, most: number, each: (item: unknown) => boolean) => {
  const list = record(value);
  return (
    list !== undefined &&
    isList(list.items, most, each) &&
    isCount(list.total) &&
    list.total >= (list.items as readonly unknown[]).length
  );
};
const isDetailLine = (value: unknown) => {
  const d = record(value);
  return d !== undefined && isDetailText(d.text) && isCount(d.line) && d.line >= 1;
};

function isDetails(value: unknown): value is NodeDetails {
  const d = record(value);
  const place = record(d?.place);
  return (
    d !== undefined &&
    place !== undefined &&
    isText(d.id) &&
    isText(d.name) &&
    (CODE_UNIT_KINDS as readonly unknown[]).includes(d.unit) &&
    isPosition(place) &&
    (d.signature === null || isDetailText(d.signature)) &&
    (d.returns === null || isDetailText(d.returns)) &&
    typeof d.async === 'boolean' &&
    typeof d.exported === 'boolean' &&
    isDetailList(d.params, DETAIL_LIMITS.params, (p) => {
      const param = record(p);
      return (
        param !== undefined &&
        isDetailText(param.name) &&
        isDetailText(param.type) &&
        typeof param.optional === 'boolean'
      );
    }) &&
    isDetailList(d.decisions, DETAIL_LIMITS.items, (item) => {
      const decision = record(item);
      return (
        decision !== undefined &&
        (DECISION_KINDS as readonly unknown[]).includes(decision.kind) &&
        isDetailText(decision.condition) &&
        isList(decision.outcomes, DETAIL_LIMITS.outcomes, isDetailText) &&
        isCount(decision.line) &&
        decision.line >= 1
      );
    }) &&
    isDetailList(d.throws, DETAIL_LIMITS.items, isDetailLine) &&
    isDetailList(d.awaits, DETAIL_LIMITS.items, isDetailLine) &&
    isDetailList(d.writes, DETAIL_LIMITS.items, isDetailLine) &&
    isDetailList(d.unresolved, DETAIL_LIMITS.items, (item) => {
      const call = record(item);
      return (
        call !== undefined &&
        isDetailText(call.text) &&
        isList(call.lines, FLOW_LIMITS.lines, (line) => isCount(line) && line >= 1) &&
        (call.lines as readonly unknown[]).length > 0
      );
    })
  );
}

function isFlowResult(value: unknown): value is FlowResult {
  const r = record(value);
  return (
    r !== undefined &&
    (r.flow === null || isFlow(r.flow)) &&
    isMessage(r.message) &&
    (r.version === null || (typeof r.version === 'string' && /^[0-9a-f]{64}$/.test(r.version))) &&
    (r.takenAt === null ||
      (typeof r.takenAt === 'string' &&
        r.takenAt.length <= 40 &&
        !Number.isNaN(Date.parse(r.takenAt)))) &&
    typeof r.current === 'boolean' &&
    typeof r.complete === 'boolean'
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
    case 'graph':
      return isGraphStatus(result);
    case 'flow':
      return isFlowResult(result);
    case 'details':
      return (
        result !== undefined &&
        (result.details === null || isDetails(result.details)) &&
        isMessage(result.message)
      );
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
