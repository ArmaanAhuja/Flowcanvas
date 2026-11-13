// What changed between two snapshots of a graph (research report: "a graph diff of before and after snapshots").
// The live canvas (phase 22) and the behavioural diff (stage 4) build on it.
import { edgeKey, type Graph, type GraphEdge, type GraphNode } from './model.js';

export interface GraphDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** In both, but its name, kind, place, what it is, or its outgoing edges changed. */
  readonly modified: readonly string[];
  readonly edgesAdded: readonly GraphEdge[];
  readonly edgesRemoved: readonly GraphEdge[];
}

const sameNode = (a: GraphNode, b: GraphNode) =>
  a.kind === b.kind &&
  a.name === b.name &&
  a.unit === b.unit &&
  a.place?.path === b.place?.path &&
  a.place?.line === b.place?.line &&
  a.place?.column === b.place?.column;

const sameLines = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((line, i) => line === b[i]);

const sameEdge = (a: GraphEdge, b: GraphEdge) =>
  a.provenance === b.provenance &&
  sameLines(a.lines, b.lines) &&
  sameLines(a.guarded ?? [], b.guarded ?? []);

export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  const now = new Map(after.nodes.map((n) => [n.id, n]));
  const oldEdges = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const newEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  const edgesAdded: GraphEdge[] = [];
  const edgesRemoved: GraphEdge[] = [];
  // A node whose outgoing edges changed behaves differently: it's modified even if it didn't move.
  const touched = new Set<string>();
  for (const [key, edge] of newEdges) {
    const was = oldEdges.get(key);
    if (was === undefined) edgesAdded.push(edge);
    if (was === undefined || !sameEdge(was, edge)) touched.add(edge.from);
  }
  for (const [key, edge] of oldEdges) {
    if (!newEdges.has(key)) {
      edgesRemoved.push(edge);
      touched.add(edge.from);
    }
  }
  const added = [...now.keys()].filter((id) => !old.has(id)).sort();
  const removed = [...old.keys()].filter((id) => !now.has(id)).sort();
  const modified = [...now.values()]
    .filter((node) => {
      const was = old.get(node.id);
      return was !== undefined && (!sameNode(was, node) || touched.has(node.id));
    })
    .map((node) => node.id)
    .sort();
  return { added, removed, modified, edgesAdded, edgesRemoved };
}

/**
 * The later graph with each node's change state from the diff; removed nodes kept, marked removed, so they can be
 * drawn ghosted (phase 22). Whether a node is possibly affected is the blast radius's to say (stage 4), not a diff's.
 */
export function withChanges(before: Graph, after: Graph, diff = diffGraphs(before, after)): Graph {
  const added = new Set(diff.added);
  const modified = new Set(diff.modified);
  const removed = before.nodes.filter((n) => diff.removed.includes(n.id));
  return {
    nodes: [
      ...after.nodes.map((n): GraphNode => ({
        ...n,
        change: added.has(n.id) ? 'added' : modified.has(n.id) ? 'modified' : 'unchanged',
      })),
      ...removed.map((n) => ({ ...n, change: 'removed' as const })),
    ] satisfies GraphNode[],
    edges: after.edges,
  };
}
