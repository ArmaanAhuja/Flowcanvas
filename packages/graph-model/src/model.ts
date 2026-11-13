// The flow graph's core vocabulary (build plan phase 6; research report, "Recommended architecture"; ADR 0027).
// Plain data: the engine builds it, the page reads it, and nothing here needs Node or the browser.

/**
 * What a node is. Phase 6 fills `code-unit`; the rest arrive with their phases (entry points 8, data access and
 * external boundaries 10, async hand-offs and decisions later in stage 1).
 */
export const NODE_KINDS = [
  'entry-point',
  'code-unit',
  'decision',
  'data-access',
  'async-handoff',
  'external-boundary',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** What a code unit is. `module` is a file's top level: the code outside any named function. */
export const CODE_UNIT_KINDS = ['function', 'method', 'component', 'class', 'module'] as const;
export type CodeUnitKind = (typeof CODE_UNIT_KINDS)[number];

/**
 * What an edge is: a `call` (a function calling or rendering another), a `branch` (a decision to one of its
 * outcomes), `data` (to a read or write), a `handoff` (work given to a queue, an event or a timer), a `boundary`
 * (a call leaving the project for an outside service).
 */
export const EDGE_KINDS = ['call', 'branch', 'data', 'handoff', 'boundary'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** A call's relation (phase 5): a plain call, or a component rendered. */
export const RELATIONS = ['calls', 'renders'] as const;
export type Relation = (typeof RELATIONS)[number];

/**
 * How an edge is known (CLAUDE.md rule 4): seen running, proven by the compiler, matched by a framework rule,
 * proposed by a model (never drawn solid), or not known (a call whose target couldn't be found).
 */
export const PROVENANCES = ['observed', 'resolved', 'convention', 'suggested', 'unknown'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** A node's change since the snapshot it's compared with; `analysing` while its analysis is behind an edit. */
export const CHANGE_STATES = [
  'unchanged',
  'added',
  'modified',
  'removed',
  'possibly-affected',
  'analysing',
] as const;
export type ChangeState = (typeof CHANGE_STATES)[number];

/** A place in the project: a project-relative path and a 1-based line and column. */
export interface Place {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export interface GraphNode {
  /** The file and qualified name (`src/poll.ts#PollService.create`), never the line: moving code keeps it. */
  readonly id: string;
  readonly kind: NodeKind;
  readonly name: string;
  readonly place: Place | null;
  /** For a code unit: what it is. */
  readonly unit: CodeUnitKind | null;
  readonly change: ChangeState;
}

export interface GraphEdge {
  readonly from: string;
  /** The node it reaches; null when unknown (the call's text is in `target`). */
  readonly to: string | null;
  /** For an unknown edge: the call as written (`prisma.poll.create`), drawn as an open stub. */
  readonly target: string | null;
  readonly kind: EdgeKind;
  /** For a call, or a branch reaching a call: calls or renders. */
  readonly relation: Relation | null;
  /**
   * For a branch out of a decision (phase 7, ADR 0028): the outcome it's taken on ("yes", "no", "case 'DRAFT'",
   * "error"). A branch into a decision, and every other edge, has none.
   */
  readonly label: string | null;
  readonly provenance: Provenance;
  /** Lines in the `from` node's file where it happens, ascending. */
  readonly lines: readonly number[];
  /**
   * On a call: those of its lines where every call sits under a decision of its unit (a flow draws them through the
   * decision, not straight). Absent when there are none. Said per line by the pass, since `hasId(a) && hasId(b)` has
   * one call that always happens and one that's guarded on the same line (phase 7's labels found it).
   */
  readonly guarded?: readonly number[];
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** One version of a project's graph. */
export interface Snapshot {
  /** The SHA-256 of its encoding (hex): the same graph is the same version. */
  readonly version: string;
  /** When it was taken (ISO 8601). */
  readonly takenAt: string;
  /** False when the analysis stopped early (memory, or a limit): said in `note`. */
  readonly complete: boolean;
  readonly note: string | null;
  /** Source files the analysis read. */
  readonly files: number;
  /** Calls into TypeScript's standard library: counted, not in the graph (owner, 12 Nov 2026). */
  readonly builtInCalls: number;
  readonly graph: Graph;
}

/** An edge's identity: two edges with the same key are the same connection. */
export const edgeKey = (edge: GraphEdge): string =>
  [
    edge.from,
    edge.to ?? `?${edge.target ?? ''}`,
    edge.kind,
    edge.relation ?? '',
    edge.label ?? '',
  ].join('\u0000');
