// Counts for Labs → Graph stats (phase 6's Try it): every kind listed, zeros included (owner, 12 Nov 2026).
import {
  CODE_UNIT_KINDS,
  EDGE_KINDS,
  NODE_KINDS,
  PROVENANCES,
  type CodeUnitKind,
  type EdgeKind,
  type Graph,
  type NodeKind,
  type Provenance,
} from './model.js';

export interface GraphStats {
  readonly nodes: number;
  readonly edges: number;
  readonly byNodeKind: Readonly<Record<NodeKind, number>>;
  readonly byCodeUnit: Readonly<Record<CodeUnitKind, number>>;
  readonly byEdgeKind: Readonly<Record<EdgeKind, number>>;
  readonly byProvenance: Readonly<Record<Provenance, number>>;
}

const zeros = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function graphStats(graph: Graph): GraphStats {
  const byNodeKind = zeros(NODE_KINDS);
  const byCodeUnit = zeros(CODE_UNIT_KINDS);
  const byEdgeKind = zeros(EDGE_KINDS);
  const byProvenance = zeros(PROVENANCES);
  for (const node of graph.nodes) {
    byNodeKind[node.kind] += 1;
    if (node.unit !== null) byCodeUnit[node.unit] += 1;
  }
  for (const edge of graph.edges) {
    byEdgeKind[edge.kind] += 1;
    byProvenance[edge.provenance] += 1;
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    byNodeKind,
    byCodeUnit,
    byEdgeKind,
    byProvenance,
  };
}

/** When each kind not filled yet arrives (build plan): shown with its zero (owner, 12 Nov 2026). */
export const ARRIVES_IN: Readonly<Partial<Record<NodeKind | EdgeKind, number>>> = {
  'entry-point': 8,
  'data-access': 10,
  'external-boundary': 10,
  'async-handoff': 11,
  decision: 7,
  branch: 7,
  data: 10,
  boundary: 10,
  handoff: 11,
};
