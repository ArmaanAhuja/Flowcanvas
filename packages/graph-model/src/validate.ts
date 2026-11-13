import {
  CHANGE_STATES,
  CODE_UNIT_KINDS,
  EDGE_KINDS,
  NODE_KINDS,
  PROVENANCES,
  RELATIONS,
  edgeKey,
  type Graph,
} from './model.js';

const isPositiveInteger = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;
const has = (list: readonly string[], value: unknown) =>
  typeof value === 'string' && list.includes(value);

/**
 * Every rule a graph must keep (the schema of ADR 0027 §3). Returns what's wrong, at most `limit` problems; an empty
 * list means the graph is valid.
 */
export function validateGraph(graph: Graph, limit = 50): string[] {
  const problems: string[] = [];
  const say = (problem: string) => {
    if (problems.length < limit) problems.push(problem);
  };
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || node.id === '') say('a node has no id');
    else if (ids.has(node.id)) say(`node ${node.id} appears twice`);
    else ids.add(node.id);
    if (!has(NODE_KINDS, node.kind)) say(`node ${node.id}: unknown kind ${node.kind}`);
    if (typeof node.name !== 'string' || node.name === '') say(`node ${node.id}: no name`);
    if (!has(CHANGE_STATES, node.change)) say(`node ${node.id}: unknown change ${node.change}`);
    if (node.kind === 'code-unit' ? !has(CODE_UNIT_KINDS, node.unit) : node.unit !== null) {
      say(`node ${node.id}: a code unit needs what it is, and only a code unit has one`);
    }
    if (
      node.place !== null &&
      (typeof node.place.path !== 'string' ||
        node.place.path === '' ||
        !isPositiveInteger(node.place.line) ||
        !isPositiveInteger(node.place.column))
    ) {
      say(`node ${node.id}: its place isn't a path with a 1-based line and column`);
    }
  }
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const keys = new Set<string>();
  for (const edge of graph.edges) {
    const name = `edge ${edge.from} → ${edge.to ?? (edge.target === null || edge.target === '' ? '?' : edge.target)}`;
    if (!ids.has(edge.from)) say(`${name}: from a node that isn't in the graph`);
    if (!has(EDGE_KINDS, edge.kind)) say(`${name}: unknown kind ${edge.kind}`);
    if (!has(PROVENANCES, edge.provenance)) {
      say(`${name}: unknown provenance ${edge.provenance}`);
    }
    // A branch out of a decision reaches a call: it says calls or renders, as the call does (ADR 0028).
    const toDecision = edge.to !== null && kinds.get(edge.to) === 'decision';
    const reachesCall =
      edge.kind === 'call' || (edge.kind === 'branch' && edge.label !== null && !toDecision);
    if (reachesCall ? !has(RELATIONS, edge.relation) : edge.relation !== null) {
      say(`${name}: a call needs calls or renders, and only a call has one`);
    }
    const fromDecision = kinds.get(edge.from) === 'decision';
    if (edge.kind !== 'branch' && edge.label !== null) say(`${name}: only a branch has a label`);
    if (edge.kind === 'branch') {
      if (fromDecision && (typeof edge.label !== 'string' || edge.label === '')) {
        say(`${name}: a branch out of a decision needs its outcome`);
      }
      if (
        !fromDecision &&
        (edge.label !== null || edge.to === null || kinds.get(edge.to) !== 'decision')
      ) {
        say(`${name}: a branch from code goes into a decision, without a label`);
      }
    }
    // Unknown means the target wasn't found: never a node, always the call's text. Anything else reaches a node.
    if (edge.provenance === 'unknown') {
      if (edge.to !== null) say(`${name}: an unknown edge can't reach a node`);
      if (typeof edge.target !== 'string' || edge.target === '') {
        say(`${name}: an unknown edge needs the call's text`);
      }
    } else {
      if (edge.to === null || !ids.has(edge.to)) say(`${name}: to a node that isn't in the graph`);
      if (edge.target !== null) say(`${name}: only an unknown edge has a text target`);
    }
    if (
      edge.lines.length === 0 ||
      !edge.lines.every(
        (line, i) => isPositiveInteger(line) && (i === 0 || line > (edge.lines[i - 1] ?? 0)),
      )
    ) {
      say(`${name}: its lines must be 1-based, ascending, each once`);
    }
    if (edge.guarded !== undefined) {
      if (edge.kind !== 'call') say(`${name}: only a call has guarded lines`);
      const lines = new Set(edge.lines);
      if (
        edge.guarded.length === 0 ||
        !edge.guarded.every(
          (line, i) => lines.has(line) && (i === 0 || line > (edge.guarded?.[i - 1] ?? 0)),
        )
      ) {
        say(`${name}: its guarded lines must be some of its lines, ascending, each once`);
      }
    }
    const key = edgeKey(edge);
    if (keys.has(key)) say(`${name}: appears twice`);
    keys.add(key);
  }
  return problems;
}
