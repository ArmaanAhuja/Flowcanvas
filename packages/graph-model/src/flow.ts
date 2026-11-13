// A downstream flow from one code unit (phase 7, ADR 0028): breadth-first over what it calls, through the decisions
// that guard those calls, up to a cap, from one version of the graph. Pure: the engine runs it on the latest snapshot.
import {
  PROVENANCES,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Provenance,
  type Relation,
} from './model.js';

/** Most nodes a flow shows (owner, 12 Nov 2026); what's cut is said, never dropped silently. */
export const FLOW_MAX_NODES = 60;

/**
 * What a flow carries, so it fits in one engine message (the inspector's details have the full lists): lines kept per
 * edge (`sites` says how many there are), and unknown calls listed per node (`total` says how many there are).
 */
export const FLOW_LIMITS = {
  lines: 10,
  unknown: 20,
} as const;

/** A graph made quick to walk: nodes by id, edges by where they start, code units by place. */
export interface GraphIndex {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly out: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Code units by `path:line:column` of their name. */
  readonly byPlace: ReadonlyMap<string, string>;
}

export const placeKey = (path: string, line: number, column: number) =>
  `${path}:${String(line)}:${String(column)}`;

export function indexGraph(graph: Graph): GraphIndex {
  const nodes = new Map<string, GraphNode>();
  const byPlace = new Map<string, string>();
  for (const node of graph.nodes) {
    nodes.set(node.id, node);
    if (node.kind === 'code-unit' && node.place !== null) {
      byPlace.set(placeKey(node.place.path, node.place.line, node.place.column), node.id);
    }
  }
  const out = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge]);
    else list.push(edge);
  }
  return { nodes, out, byPlace };
}

/** An edge as a flow draws it: between two shown nodes. */
export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'call' | 'branch';
  readonly relation: Relation | null;
  /** The outcome, on a branch out of a decision ("yes", "case 'DRAFT'", "error"). */
  readonly label: string | null;
  readonly provenance: Provenance;
  /** The first lines where it happens (FLOW_LIMITS.lines), in the `from` node's file. */
  readonly lines: readonly number[];
  /** How many lines there are in all. */
  readonly sites: number;
}

/** A call whose target wasn't found, as written. */
export interface FlowUnknownCall {
  readonly target: string;
  readonly relation: Relation | null;
  /** The outcome it's taken on, when a decision guards it. */
  readonly label: string | null;
  readonly lines: readonly number[];
  readonly sites: number;
}

/** One node's unknown calls: drawn as one open stub, "N unknown calls" (owner, 12 Nov 2026). */
export interface FlowUnknownGroup {
  readonly from: string;
  readonly total: number;
  /** The first FLOW_LIMITS.unknown of them. */
  readonly calls: readonly FlowUnknownCall[];
}

/** Where the flow stopped at the cap: this shown node leads to `nodes` nodes that aren't shown. */
export interface FlowCut {
  readonly from: string;
  readonly nodes: number;
}

export interface Flow {
  readonly root: string;
  /** Breadth-first, the root first. */
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly FlowEdge[];
  readonly unknown: readonly FlowUnknownGroup[];
  readonly cut: readonly FlowCut[];
  /** Nodes not shown, in all: the stub's "N more calls not shown". */
  readonly hidden: number;
  /** The completeness pill: the flow's edges that reach calls (drawn and unknown), by how each is known. */
  readonly byProvenance: Readonly<Record<Provenance, number>>;
}

/**
 * What a flow follows out of a node. Out of a code unit: its branches into decisions, and its calls, less the
 * lines where a decision guards every call (those are drawn through the decision). Out of a decision: its branches.
 */
function outgoing(index: GraphIndex, id: string): GraphEdge[] {
  const node = index.nodes.get(id);
  const edges = index.out.get(id) ?? [];
  if (node?.kind === 'decision') return edges.filter((edge) => edge.kind === 'branch');
  const result: GraphEdge[] = edges.filter(
    (edge) => edge.kind === 'branch' && edge.to !== null && isDecision(index, edge.to),
  );
  for (const edge of edges) {
    if (edge.kind !== 'call') continue;
    const guarded = new Set(edge.guarded ?? []);
    const lines = edge.lines.filter((line) => !guarded.has(line));
    if (lines.length > 0)
      result.push(lines.length === edge.lines.length ? edge : { ...edge, lines });
  }
  return result;
}

const isDecision = (index: GraphIndex, id: string) => index.nodes.get(id)?.kind === 'decision';

const capped = (lines: readonly number[]) => ({
  lines: lines.slice(0, FLOW_LIMITS.lines),
  sites: lines.length,
});

/** The flow downstream of `root` (a code unit's id), or undefined when the graph doesn't have it. */
export function buildFlow(
  index: GraphIndex,
  root: string,
  maxNodes = FLOW_MAX_NODES,
): Flow | undefined {
  const start = index.nodes.get(root);
  if (start?.kind !== 'code-unit') return undefined;
  const shown = new Map<string, GraphNode>([[root, start]]);
  const queue = [root];
  const edges: FlowEdge[] = [];
  const unknown: FlowUnknownGroup[] = [];
  const cut: FlowCut[] = [];
  const hidden = new Set<string>();
  const byProvenance = Object.fromEntries(PROVENANCES.map((p) => [p, 0])) as Record<
    Provenance,
    number
  >;
  // An array's iterator reads its length at every step, so nodes queued during the loop are visited too.
  for (const from of queue) {
    const calls: FlowUnknownCall[] = [];
    const notShown = new Set<string>();
    for (const edge of outgoing(index, from)) {
      // Edges into decisions are the flow's shape, not calls: the pill doesn't count them.
      const counted = edge.to === null || !isDecision(index, edge.to);
      if (edge.to === null) {
        byProvenance[edge.provenance] += 1;
        calls.push({
          target: edge.target ?? '',
          relation: edge.relation,
          label: edge.label,
          ...capped(edge.lines),
        });
        continue;
      }
      const to = index.nodes.get(edge.to);
      if (to === undefined) continue;
      if (!shown.has(to.id)) {
        if (shown.size >= maxNodes) {
          notShown.add(to.id);
          hidden.add(to.id);
          continue;
        }
        shown.set(to.id, to);
        queue.push(to.id);
      }
      if (counted) byProvenance[edge.provenance] += 1;
      edges.push({
        from,
        to: to.id,
        kind: edge.kind === 'branch' ? 'branch' : 'call',
        relation: edge.relation,
        label: edge.label,
        provenance: edge.provenance,
        ...capped(edge.lines),
      });
    }
    if (calls.length > 0) {
      unknown.push({ from, total: calls.length, calls: calls.slice(0, FLOW_LIMITS.unknown) });
    }
    if (notShown.size > 0) cut.push({ from, nodes: notShown.size });
  }
  return {
    root,
    nodes: [...shown.values()],
    edges,
    unknown,
    cut,
    hidden: hidden.size,
    byProvenance,
  };
}
