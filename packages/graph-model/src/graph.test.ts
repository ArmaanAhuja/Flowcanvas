import { describe, expect, it } from 'vitest';
import { diffGraphs, withChanges } from './diff.js';
import { decodeGraph, encodeGraph } from './encoding.js';
import { edgeKey, type Graph, type GraphEdge, type GraphNode } from './model.js';
import { ARRIVES_IN, graphStats } from './stats.js';
import { validateGraph } from './validate.js';

const unit = (id: string, line = 1, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind: 'code-unit',
  name: id.split('#')[1] ?? id,
  place: { path: id.split('#')[0] ?? 'a.ts', line, column: 1 },
  unit: 'function',
  change: 'unchanged',
  ...extra,
});
const call = (
  from: string,
  to: string,
  lines = [3],
  extra: Partial<GraphEdge> = {},
): GraphEdge => ({
  from,
  to,
  target: null,
  kind: 'call',
  relation: 'calls',
  label: null,
  provenance: 'resolved',
  lines,
  ...extra,
});
const unknown = (from: string, target: string, lines = [4]): GraphEdge => ({
  from,
  to: null,
  target,
  kind: 'call',
  relation: 'calls',
  label: null,
  provenance: 'unknown',
  lines,
});

const POLL: Graph = {
  nodes: [
    unit('src/poll.ts#createPoll', 98),
    unit('src/poll.ts#toPollResponse', 82),
    unit('src/route.ts#(top level)', 1, { name: '(top level)', unit: 'module' }),
    unit('src/form.tsx#PollForm', 5, { unit: 'component' }),
  ],
  edges: [
    call('src/route.ts#(top level)', 'src/poll.ts#createPoll', [404, 476]),
    call('src/poll.ts#createPoll', 'src/poll.ts#toPollResponse', [152]),
    unknown('src/poll.ts#createPoll', 'prisma.$transaction', [115]),
    call('src/form.tsx#PollForm', 'src/form.tsx#PollForm', [20], { relation: 'renders' }),
  ],
};

describe('validateGraph', () => {
  it('accepts a graph that keeps every rule', () => {
    expect(validateGraph(POLL)).toEqual([]);
  });

  it('says what breaks each rule', () => {
    const broken: Graph = {
      nodes: [
        unit('a.ts#f'),
        unit('a.ts#f'),
        unit('a.ts#g', 1, { unit: null }),
        unit('a.ts#h', 0),
        { ...unit('a.ts#e'), kind: 'external-boundary' },
      ],
      edges: [
        call('a.ts#f', 'a.ts#missing'),
        unknown('a.ts#f', ''),
        { ...unknown('a.ts#f', 'x()'), to: 'a.ts#g' },
        call('nowhere#x', 'a.ts#f'),
        call('a.ts#f', 'a.ts#g', [5, 3]),
        call('a.ts#f', 'a.ts#e', [1], { relation: null }),
        call('a.ts#f', 'a.ts#e', [1], { kind: 'data' }),
        call('a.ts#g', 'a.ts#f', [1], { target: 'f()' }),
      ],
    };
    expect(validateGraph(broken)).toEqual([
      'node a.ts#f appears twice',
      'node a.ts#g: a code unit needs what it is, and only a code unit has one',
      "node a.ts#h: its place isn't a path with a 1-based line and column",
      'node a.ts#e: a code unit needs what it is, and only a code unit has one',
      "edge a.ts#f → a.ts#missing: to a node that isn't in the graph",
      "edge a.ts#f → ?: an unknown edge needs the call's text",
      "edge a.ts#f → a.ts#g: an unknown edge can't reach a node",
      "edge nowhere#x → a.ts#f: from a node that isn't in the graph",
      'edge a.ts#f → a.ts#g: its lines must be 1-based, ascending, each once',
      // The same connection as the unknown edge above it (f calls g): one edge per connection.
      'edge a.ts#f → a.ts#g: appears twice',
      'edge a.ts#f → a.ts#e: a call needs calls or renders, and only a call has one',
      'edge a.ts#f → a.ts#e: a call needs calls or renders, and only a call has one',
      'edge a.ts#g → a.ts#f: only an unknown edge has a text target',
    ]);
  });

  it('stops at its limit', () => {
    const many: Graph = {
      nodes: [],
      edges: Array.from({ length: 10 }, (_, i) => call(`x#${String(i)}`, 'y#y')),
    };
    expect(validateGraph(many, 3)).toHaveLength(3);
  });
});

describe('encodeGraph and decodeGraph', () => {
  it('round-trips, and the same graph in any order encodes the same', () => {
    const text = encodeGraph(POLL);
    const decoded = decodeGraph(text);
    const sorted = (edges: readonly GraphEdge[]) =>
      [...edges].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));
    expect(decoded.nodes).toEqual([...POLL.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(decoded.edges).toEqual(sorted(POLL.edges));
    const shuffled: Graph = { nodes: [...POLL.nodes].reverse(), edges: [...POLL.edges].reverse() };
    expect(encodeGraph(shuffled)).toBe(text);
  });

  it('stores each file path once, for ids and places alike', () => {
    const encoded = JSON.parse(encodeGraph(POLL)) as { paths: string[]; nodes: unknown[][] };
    expect(encoded.paths.sort()).toEqual(['src/form.tsx', 'src/poll.ts', 'src/route.ts']);
    expect(JSON.stringify(encoded.nodes)).not.toContain('src/poll.ts');
  });

  it('skips the schema check only when asked: for bytes the caller has proved', () => {
    const invalid = encodeGraph({
      nodes: [unit('a.ts#f')],
      edges: [call('a.ts#f', 'a.ts#f', [2, 1])],
    });
    expect(() => decodeGraph(invalid)).toThrow(/Invalid graph/);
    expect(decodeGraph(invalid, { validate: false }).edges).toHaveLength(1);
  });

  it('stores an unknown target once however many edges reach it', () => {
    const graph: Graph = {
      nodes: [unit('a.ts#f'), unit('a.ts#g')],
      edges: [unknown('a.ts#f', 'useState()'), unknown('a.ts#g', 'useState()')],
    };
    expect((JSON.parse(encodeGraph(graph)) as { texts: string[] }).texts).toEqual(['useState()']);
  });

  it('refuses another format, a bad index, and an invalid graph', () => {
    expect(() => decodeGraph('{"format":3}')).toThrow('Unsupported graph format 3');
    const text = JSON.parse(encodeGraph(POLL)) as { edges: number[][] };
    const [first] = text.edges;
    if (first === undefined) throw new Error('no edge');
    first[0] = 99;
    expect(() => decodeGraph(JSON.stringify(text))).toThrow('Bad node index 99');
    const invalid = encodeGraph({
      nodes: [unit('a.ts#f')],
      edges: [call('a.ts#f', 'a.ts#f', [2, 1])],
    });
    expect(() => decodeGraph(invalid)).toThrow(/Invalid graph: .*ascending/);
  });
});

describe('diffGraphs', () => {
  it('sees nodes added and removed, edges added and removed, and who changed', () => {
    const after: Graph = {
      nodes: [
        unit('src/poll.ts#createPoll', 98),
        unit('src/route.ts#(top level)', 1, { name: '(top level)', unit: 'module' }),
        unit('src/form.tsx#PollForm', 5, { unit: 'component' }),
        unit('src/poll.ts#closePoll', 160),
      ],
      edges: [
        call('src/route.ts#(top level)', 'src/poll.ts#createPoll', [404, 476]),
        unknown('src/poll.ts#createPoll', 'prisma.$transaction', [115]),
        call('src/form.tsx#PollForm', 'src/form.tsx#PollForm', [20], { relation: 'renders' }),
        call('src/form.tsx#PollForm', 'src/poll.ts#closePoll', [30]),
      ],
    };
    const diff = diffGraphs(POLL, after);
    expect(diff.added).toEqual(['src/poll.ts#closePoll']);
    expect(diff.removed).toEqual(['src/poll.ts#toPollResponse']);
    // createPoll lost an edge; PollForm gained one. The route didn't change.
    expect(diff.modified).toEqual(['src/form.tsx#PollForm', 'src/poll.ts#createPoll']);
    expect(diff.edgesAdded.map((e) => e.to)).toEqual(['src/poll.ts#closePoll']);
    expect(diff.edgesRemoved.map((e) => e.to)).toEqual(['src/poll.ts#toPollResponse']);
  });

  it('counts code that moved, or a call made from another line, as modified, not removed and added', () => {
    const moved: Graph = {
      nodes: POLL.nodes.map((n) =>
        n.id === 'src/poll.ts#toPollResponse'
          ? { ...n, place: { path: 'src/poll.ts', line: 90, column: 1 } }
          : n,
      ),
      edges: POLL.edges.map((e) =>
        e.to === 'src/poll.ts#createPoll' ? { ...e, lines: [404, 480] } : e,
      ),
    };
    const diff = diffGraphs(POLL, moved);
    expect(diff).toMatchObject({ added: [], removed: [], edgesAdded: [], edgesRemoved: [] });
    expect(diff.modified).toEqual(['src/poll.ts#toPollResponse', 'src/route.ts#(top level)']);
  });

  it('marks change states, keeping removed nodes to draw as ghosts', () => {
    const after: Graph = { nodes: POLL.nodes.slice(0, 3), edges: POLL.edges.slice(0, 3) };
    const marked = withChanges(POLL, after);
    expect(marked.nodes.map((n) => `${n.id}:${n.change}`)).toEqual([
      'src/poll.ts#createPoll:unchanged',
      'src/poll.ts#toPollResponse:unchanged',
      'src/route.ts#(top level):unchanged',
      'src/form.tsx#PollForm:removed',
    ]);
  });
});

describe('graphStats', () => {
  it('counts every kind and provenance, zeros included, and says when the missing kinds arrive', () => {
    const stats = graphStats(POLL);
    expect(stats).toMatchObject({ nodes: 4, edges: 4 });
    expect(stats.byNodeKind).toEqual({
      'entry-point': 0,
      'code-unit': 4,
      decision: 0,
      'data-access': 0,
      'async-handoff': 0,
      'external-boundary': 0,
    });
    expect(stats.byCodeUnit).toEqual({ function: 2, method: 0, component: 1, class: 0, module: 1 });
    expect(stats.byProvenance).toEqual({
      observed: 0,
      resolved: 3,
      convention: 0,
      suggested: 0,
      unknown: 1,
    });
    expect(stats.byEdgeKind.call).toBe(4);
    // Every kind not filled yet names its phase (build plan, stage 1); code units and decisions are filled.
    for (const [kind, count] of Object.entries(stats.byNodeKind)) {
      if (kind === 'code-unit') expect(count).toBe(4);
      else if (kind !== 'decision') {
        expect(ARRIVES_IN[kind as keyof typeof ARRIVES_IN], kind).toBeGreaterThan(7);
      }
    }
    expect(ARRIVES_IN).not.toHaveProperty('decision');
    expect(ARRIVES_IN).not.toHaveProperty('branch');
  });
});

describe('decisions (phase 7, ADR 0028)', () => {
  const decision = (id: string, name: string, line: number): GraphNode => ({
    id,
    kind: 'decision',
    name,
    place: { path: 'src/send.ts', line, column: 3 },
    unit: null,
    change: 'unchanged',
  });
  const branch = (
    from: string,
    to: string | null,
    label: string | null,
    extra: Partial<GraphEdge> = {},
  ): GraphEdge => ({
    from,
    to,
    target: null,
    kind: 'branch',
    relation: label === null ? null : 'calls',
    label,
    provenance: 'resolved',
    lines: [10],
    ...extra,
  });
  const SEND: Graph = {
    nodes: [
      unit('src/send.ts#sendDocument', 5),
      unit('src/send.ts#notify', 40),
      decision('src/send.ts#sendDocument?1', 'envelope.status === DRAFT', 10),
    ],
    edges: [
      // The call stays as it was; the flow draws it through its decision.
      call('src/send.ts#sendDocument', 'src/send.ts#notify', [11]),
      branch('src/send.ts#sendDocument', 'src/send.ts#sendDocument?1', null),
      branch('src/send.ts#sendDocument?1', 'src/send.ts#notify', 'yes', { lines: [11] }),
      branch('src/send.ts#sendDocument?1', null, 'no', {
        target: 'prisma.envelope.update',
        provenance: 'unknown',
        lines: [13],
      }),
    ],
  };

  it('accepts a decision with branches in and out, and round-trips its labels', () => {
    expect(validateGraph(SEND)).toEqual([]);
    const back = decodeGraph(encodeGraph(SEND));
    expect(back.edges.filter((e) => e.label !== null).map((e) => e.label)).toEqual(['no', 'yes']);
    expect(graphStats(SEND).byNodeKind.decision).toBe(1);
    expect(graphStats(SEND).byEdgeKind.branch).toBe(3);
  });

  it('says what breaks the branch rules', () => {
    const broken: Graph = {
      nodes: SEND.nodes,
      edges: [
        // Out of a decision with no outcome.
        branch('src/send.ts#sendDocument?1', 'src/send.ts#notify', null, { relation: 'calls' }),
        // From code, but not into a decision.
        branch('src/send.ts#sendDocument', 'src/send.ts#notify', null),
        // A label on a call.
        call('src/send.ts#sendDocument', 'src/send.ts#notify', [11], { label: 'yes' }),
      ],
    };
    expect(validateGraph(broken)).toEqual([
      'edge src/send.ts#sendDocument?1 → src/send.ts#notify: a call needs calls or renders, and only a call has one',
      'edge src/send.ts#sendDocument?1 → src/send.ts#notify: a branch out of a decision needs its outcome',
      'edge src/send.ts#sendDocument → src/send.ts#notify: a branch from code goes into a decision, without a label',
      'edge src/send.ts#sendDocument → src/send.ts#notify: only a branch has a label',
    ]);
  });

  it('refuses a format 1 encoding', () => {
    expect(() => decodeGraph('{"format":1,"nodes":[],"texts":[],"edges":[]}')).toThrow(
      'Unsupported graph format 1',
    );
  });
});
