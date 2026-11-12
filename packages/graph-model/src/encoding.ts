// A snapshot's encoding (ADR 0027 §5): canonical (nodes by id, edges by key), compact (edges refer to nodes and to
// unknown targets' texts by index), and versioned. The engine gzips it and names it by its SHA-256.
import {
  CHANGE_STATES,
  CODE_UNIT_KINDS,
  EDGE_KINDS,
  NODE_KINDS,
  PROVENANCES,
  RELATIONS,
  edgeKey,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from './model.js';
import { validateGraph } from './validate.js';

export const GRAPH_FORMAT = 1;

type EncodedNode = [
  id: string,
  kind: number,
  name: string,
  path: string | null,
  line: number,
  column: number,
  unit: number,
  change: number,
];
type EncodedEdge = [
  from: number,
  to: number,
  target: number,
  kind: number,
  relation: number,
  provenance: number,
  lines: number[],
];
interface Encoded {
  readonly format: number;
  readonly nodes: EncodedNode[];
  readonly texts: string[];
  readonly edges: EncodedEdge[];
}

const byId = (a: GraphNode, b: GraphNode) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byKey = (a: GraphEdge, b: GraphEdge) => {
  const [x, y] = [edgeKey(a), edgeKey(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The graph as one canonical string: the same graph always encodes the same way. */
export function encodeGraph(graph: Graph): string {
  const nodes = [...graph.nodes].sort(byId);
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const texts: string[] = [];
  const textIndex = new Map<string, number>();
  const encoded: Encoded = {
    format: GRAPH_FORMAT,
    nodes: nodes.map((n) => [
      n.id,
      NODE_KINDS.indexOf(n.kind),
      n.name,
      n.place?.path ?? null,
      n.place?.line ?? 0,
      n.place?.column ?? 0,
      n.unit === null ? -1 : CODE_UNIT_KINDS.indexOf(n.unit),
      CHANGE_STATES.indexOf(n.change),
    ]),
    texts,
    edges: [...graph.edges].sort(byKey).map((e) => {
      let target = -1;
      if (e.target !== null) {
        target = textIndex.get(e.target) ?? texts.push(e.target) - 1;
        textIndex.set(e.target, target);
      }
      return [
        index.get(e.from) ?? -1,
        e.to === null ? -1 : (index.get(e.to) ?? -1),
        target,
        EDGE_KINDS.indexOf(e.kind),
        e.relation === null ? -1 : RELATIONS.indexOf(e.relation),
        PROVENANCES.indexOf(e.provenance),
        [...e.lines],
      ];
    }),
  };
  return JSON.stringify(encoded);
}

/** Reads an encoding back. Throws on another format or anything that doesn't decode to a valid graph. */
export function decodeGraph(text: string): Graph {
  const encoded = JSON.parse(text) as Partial<Encoded>;
  if (encoded.format !== GRAPH_FORMAT) {
    throw new Error(`Unsupported graph format ${String(encoded.format)}`);
  }
  const pick = <T>(list: readonly T[], i: number, what: string): T => {
    const value = list[i];
    if (value === undefined) throw new Error(`Bad ${what} index ${String(i)}`);
    return value;
  };
  const nodes: GraphNode[] = (encoded.nodes ?? []).map(
    ([id, kind, name, path, line, column, unit, change]) => ({
      id,
      kind: pick(NODE_KINDS, kind, 'node kind'),
      name,
      place: path === null ? null : { path, line, column },
      unit: unit === -1 ? null : pick(CODE_UNIT_KINDS, unit, 'code unit'),
      change: pick(CHANGE_STATES, change, 'change state'),
    }),
  );
  const texts = encoded.texts ?? [];
  const edges: GraphEdge[] = (encoded.edges ?? []).map(
    ([from, to, target, kind, relation, provenance, lines]) => ({
      from: pick(nodes, from, 'node').id,
      to: to === -1 ? null : pick(nodes, to, 'node').id,
      target: target === -1 ? null : pick(texts, target, 'text'),
      kind: pick(EDGE_KINDS, kind, 'edge kind'),
      relation: relation === -1 ? null : pick(RELATIONS, relation, 'relation'),
      provenance: pick(PROVENANCES, provenance, 'provenance'),
      lines,
    }),
  );
  const graph = { nodes, edges };
  const problems = validateGraph(graph, 3);
  if (problems.length > 0) throw new Error(`Invalid graph: ${problems.join('; ')}`);
  return graph;
}
