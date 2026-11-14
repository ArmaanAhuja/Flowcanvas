// A snapshot's encoding (ADR 0027 §5): canonical (nodes by id, edges by key), compact (edges refer to nodes and to
// unknown targets' texts by index), and versioned. The engine gzips it and names it by its SHA-256.
import {
  CHANGE_STATES,
  CODE_UNIT_KINDS,
  EDGE_KINDS,
  ENTRY_KINDS,
  NODE_KINDS,
  PROVENANCES,
  RELATIONS,
  edgeKey,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from './model.js';
import { validateGraph } from './validate.js';

/**
 * 2 (phase 7, ADR 0028): edges carry a label (decisions' outcomes), and file paths are stored once in a table
 * rather than in every node's id and place. A version 1 snapshot is replaced by the next pass.
 * 3 (phase 7): a call edge says which of its lines are guarded (`GraphEdge.guarded`); a version 2 graph can't say.
 * 4 (phase 8, ADR 0030): an entry point's node carries its details (`GraphNode.entry`); a version 3 graph has none.
 */
export const GRAPH_FORMAT = 4;

type EncodedNode = [
  /** The id's file, as an index into `paths`; -1 when the id has no `#` (then `idRest` is the whole id). */
  idPath: number,
  idRest: string,
  kind: number,
  name: string,
  /** The place's file, as an index into `paths`; -1 when there's no place. */
  placePath: number,
  line: number,
  column: number,
  unit: number,
  change: number,
  /** Only on an entry point: its kind, framework (a text), complete (1 or 0), why and within (texts, or -1). */
  entry?: [kind: number, framework: number, complete: number, why: number, within: number],
];
type EncodedEdge = [
  from: number,
  to: number,
  target: number,
  kind: number,
  relation: number,
  provenance: number,
  lines: number[],
  label: number,
  /** Only when there are any. */
  guarded?: number[],
];
interface Encoded {
  readonly format: number;
  readonly paths: string[];
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
  const paths: string[] = [];
  const pathIndex = new Map<string, number>();
  const pathOf = (path: string) => {
    const at = pathIndex.get(path) ?? paths.push(path) - 1;
    pathIndex.set(path, at);
    return at;
  };
  const text = (value: string | null) => {
    if (value === null) return -1;
    const at = textIndex.get(value) ?? texts.push(value) - 1;
    textIndex.set(value, at);
    return at;
  };
  const encoded: Encoded = {
    format: GRAPH_FORMAT,
    paths,
    nodes: nodes.map((n) => {
      const hash = n.id.indexOf('#');
      const encodedNode: EncodedNode = [
        hash === -1 ? -1 : pathOf(n.id.slice(0, hash)),
        hash === -1 ? n.id : n.id.slice(hash + 1),
        NODE_KINDS.indexOf(n.kind),
        n.name,
        n.place === null ? -1 : pathOf(n.place.path),
        n.place?.line ?? 0,
        n.place?.column ?? 0,
        n.unit === null ? -1 : CODE_UNIT_KINDS.indexOf(n.unit),
        CHANGE_STATES.indexOf(n.change),
      ];
      if (n.entry !== undefined) {
        encodedNode.push([
          ENTRY_KINDS.indexOf(n.entry.kind),
          text(n.entry.framework),
          n.entry.complete ? 1 : 0,
          text(n.entry.why),
          text(n.entry.within),
        ]);
      }
      return encodedNode;
    }),
    texts,
    edges: [...graph.edges].sort(byKey).map((e) => {
      const target = text(e.target);
      const encodedEdge: EncodedEdge = [
        index.get(e.from) ?? -1,
        e.to === null ? -1 : (index.get(e.to) ?? -1),
        target,
        EDGE_KINDS.indexOf(e.kind),
        e.relation === null ? -1 : RELATIONS.indexOf(e.relation),
        PROVENANCES.indexOf(e.provenance),
        [...e.lines],
        text(e.label),
      ];
      if (e.guarded !== undefined && e.guarded.length > 0) encodedEdge.push([...e.guarded]);
      return encodedEdge;
    }),
  };
  return JSON.stringify(encoded);
}

/**
 * Reads an encoding back. Throws on another format, or anything that doesn't decode to a valid graph. `validate:
 * false` skips the schema check, for a caller that has proved the bytes are ones it checked before (the snapshot
 * store checks them against their SHA-256; ADR 0028): on Twenty's graph, the check is most of a load.
 */
export function decodeGraph(text: string, options: { readonly validate?: boolean } = {}): Graph {
  const encoded = JSON.parse(text) as Partial<Encoded>;
  if (encoded.format !== GRAPH_FORMAT) {
    throw new Error(`Unsupported graph format ${String(encoded.format)}`);
  }
  const pick = <T>(list: readonly T[], i: number, what: string): T => {
    const value = list[i];
    if (value === undefined) throw new Error(`Bad ${what} index ${String(i)}`);
    return value;
  };
  const paths = encoded.paths ?? [];
  const texts = encoded.texts ?? [];
  const nodes: GraphNode[] = (encoded.nodes ?? []).map(
    ([idPath, idRest, kind, name, placePath, line, column, unit, change, entry]) => ({
      id: idPath === -1 ? idRest : `${pick(paths, idPath, 'path')}#${idRest}`,
      kind: pick(NODE_KINDS, kind, 'node kind'),
      name,
      place: placePath === -1 ? null : { path: pick(paths, placePath, 'path'), line, column },
      unit: unit === -1 ? null : pick(CODE_UNIT_KINDS, unit, 'code unit'),
      change: pick(CHANGE_STATES, change, 'change state'),
      ...(entry === undefined
        ? {}
        : {
            entry: {
              kind: pick(ENTRY_KINDS, entry[0], 'entry kind'),
              framework: pick(texts, entry[1], 'text'),
              complete: entry[2] === 1,
              why: entry[3] === -1 ? null : pick(texts, entry[3], 'text'),
              within: entry[4] === -1 ? null : pick(texts, entry[4], 'text'),
            },
          }),
    }),
  );
  const edges: GraphEdge[] = (encoded.edges ?? []).map(
    ([from, to, target, kind, relation, provenance, lines, label, guarded]) => ({
      from: pick(nodes, from, 'node').id,
      to: to === -1 ? null : pick(nodes, to, 'node').id,
      target: target === -1 ? null : pick(texts, target, 'text'),
      kind: pick(EDGE_KINDS, kind, 'edge kind'),
      relation: relation === -1 ? null : pick(RELATIONS, relation, 'relation'),
      provenance: pick(PROVENANCES, provenance, 'provenance'),
      label: label === -1 ? null : pick(texts, label, 'text'),
      lines,
      ...(guarded === undefined ? {} : { guarded }),
    }),
  );
  const graph = { nodes, edges };
  if (options.validate !== false) {
    const problems = validateGraph(graph, 3);
    if (problems.length > 0) throw new Error(`Invalid graph: ${problems.join('; ')}`);
  }
  return graph;
}
