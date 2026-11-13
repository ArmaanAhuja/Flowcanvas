import { describe, expect, it } from 'vitest';
import { FLOW_LIMITS, buildFlow, indexGraph, placeKey } from './flow.js';
import type { Graph, GraphEdge, GraphNode } from './model.js';
import { validateGraph } from './validate.js';

const unit = (name: string, line = 1): GraphNode => ({
  id: `src/a.ts#${name}`,
  kind: 'code-unit',
  name,
  place: { path: 'src/a.ts', line, column: 10 },
  unit: 'function',
  change: 'unchanged',
});
const decision = (owner: string, n: number, condition: string, line: number): GraphNode => ({
  id: `src/a.ts#${owner}?${String(n)}`,
  kind: 'decision',
  name: condition,
  place: { path: 'src/a.ts', line, column: 7 },
  unit: null,
  change: 'unchanged',
});
const id = (name: string) => `src/a.ts#${name}`;
/** A call; `guarded`: the lines where a decision guards every call (the pass says so). */
const call = (from: string, to: string, lines: number[], guarded: number[] = []): GraphEdge => ({
  from: id(from),
  to: id(to),
  target: null,
  kind: 'call',
  relation: 'calls',
  label: null,
  provenance: 'resolved',
  lines,
  ...(guarded.length > 0 ? { guarded } : {}),
});
const unknownCall = (
  from: string,
  target: string,
  lines: number[],
  guarded: number[] = [],
): GraphEdge => ({
  from: id(from),
  to: null,
  target,
  kind: 'call',
  relation: 'calls',
  label: null,
  provenance: 'unknown',
  lines,
  ...(guarded.length > 0 ? { guarded } : {}),
});
/** A branch: into a decision (no label), or out of one (an outcome, to a node or, with `target`, unknown). */
const branch = (
  from: string,
  to: string | null,
  label: string | null,
  lines: number[],
  target: string | null = null,
): GraphEdge => ({
  from: id(from),
  to: to === null ? null : id(to),
  target,
  kind: 'branch',
  relation: label === null || to?.includes('?') === true ? null : 'calls',
  label,
  provenance: to === null ? 'unknown' : 'resolved',
  lines,
});

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): Graph => {
  const graph = { nodes, edges };
  // Only graphs the pass could produce: the fixtures are checked against the schema first.
  expect(validateGraph(graph, 3)).toEqual([]);
  return graph;
};

const flowOf = (graph: Graph, root: string, maxNodes?: number) => {
  const flow = buildFlow(indexGraph(graph), id(root), maxNodes);
  if (flow === undefined) throw new Error('no flow');
  return flow;
};

describe('buildFlow', () => {
  it('walks what a function calls, breadth-first, root first', () => {
    const graph = graphOf(
      [unit('root'), unit('a', 5), unit('b', 9), unit('c', 14), unit('unrelated', 20)],
      [
        call('root', 'a', [2]),
        call('root', 'b', [3]),
        call('a', 'c', [6]),
        call('unrelated', 'a', [21]),
      ],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.nodes.map((n) => n.name)).toEqual(['root', 'a', 'b', 'c']);
    expect(flow.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      `${id('root')}>${id('a')}`,
      `${id('root')}>${id('b')}`,
      `${id('a')}>${id('c')}`,
    ]);
    expect(flow.byProvenance).toEqual({
      observed: 0,
      resolved: 3,
      convention: 0,
      suggested: 0,
      unknown: 0,
    });
    expect(flow.cut).toEqual([]);
    expect(flow.hidden).toBe(0);
  });

  it('draws a guarded call through its decision, and the same call unguarded directly', () => {
    // root: `if (ok) a()` on line 5 (condition on line 4), and `a()` again on line 9, outside the if.
    const graph = graphOf(
      [unit('root'), decision('root', 1, 'ok', 4), unit('a', 20)],
      [
        call('root', 'a', [5, 9], [5]),
        branch('root', 'root?1', null, [4]),
        branch('root?1', 'a', 'yes', [5]),
      ],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.nodes.map((n) => n.kind)).toEqual(['code-unit', 'decision', 'code-unit']);
    expect(flow.edges.map((e) => [e.from, e.to, e.kind, e.label, e.lines])).toEqual([
      [id('root'), id('root?1'), 'branch', null, [4]],
      [id('root'), id('a'), 'call', null, [9]],
      [id('root?1'), id('a'), 'branch', 'yes', [5]],
    ]);
    // The pill counts what reaches calls: the outcome and the unguarded call, not the edge into the decision.
    expect(flow.byProvenance.resolved).toBe(2);
  });

  it('draws a call that always happens even when a guarded one shares its line', () => {
    // root: `return hasId(a) && hasId(b)` on line 4: the first call always happens, the second only on yes. Found
    // by phase 7's labels (Documenso's `isRecipientBefore`): subtracting the guarded line dropped the first.
    const graph = graphOf(
      [unit('root'), decision('root', 1, 'hasId(a)', 4), unit('hasId', 20)],
      [
        call('root', 'hasId', [4]),
        branch('root', 'root?1', null, [4]),
        branch('root?1', 'hasId', 'yes', [4]),
      ],
    );
    expect(flowOf(graph, 'root').edges.map((e) => [e.from, e.to, e.kind, e.label])).toEqual([
      [id('root'), id('root?1'), 'branch', null],
      [id('root'), id('hasId'), 'call', null],
      [id('root?1'), id('hasId'), 'branch', 'yes'],
    ]);
  });

  it('follows nested decisions, and leaves out a call that is only ever guarded', () => {
    // root: `if (a) { switch (s) { case 'X': b(); } }`
    const graph = graphOf(
      [unit('root'), decision('root', 1, 'a', 3), decision('root', 2, 's', 4), unit('b', 30)],
      [
        call('root', 'b', [5], [5]),
        branch('root', 'root?1', null, [3]),
        branch('root?1', 'root?2', 'yes', [4]),
        branch('root?2', 'b', "case 'X'", [5]),
      ],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.nodes.map((n) => n.id)).toEqual([id('root'), id('root?1'), id('root?2'), id('b')]);
    expect(flow.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      [id('root'), id('root?1'), null],
      [id('root?1'), id('root?2'), 'yes'],
      [id('root?2'), id('b'), "case 'X'"],
    ]);
    expect(flow.byProvenance.resolved).toBe(1);
  });

  it('groups unknown calls per node, guarded ones under their decision', () => {
    const graph = graphOf(
      [unit('root'), decision('root', 1, 'err', 6)],
      [
        unknownCall('root', 'prisma.poll.create', [2]),
        unknownCall('root', 'logger.info', [3, 4]),
        unknownCall('root', 'notify', [7], [7]),
        branch('root', 'root?1', null, [6]),
        branch('root?1', null, 'error', [7], 'notify'),
      ],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.unknown).toEqual([
      {
        from: id('root'),
        total: 2,
        calls: [
          { target: 'prisma.poll.create', relation: 'calls', label: null, lines: [2], sites: 1 },
          { target: 'logger.info', relation: 'calls', label: null, lines: [3, 4], sites: 2 },
        ],
      },
      {
        from: id('root?1'),
        total: 1,
        calls: [{ target: 'notify', relation: 'calls', label: 'error', lines: [7], sites: 1 }],
      },
    ]);
    expect(flow.byProvenance.unknown).toBe(3);
  });

  it('stops at the cap and says where, and how much is not shown', () => {
    const graph = graphOf(
      [unit('root'), unit('a', 3), unit('b', 4), unit('c', 5), unit('d', 6), unit('e', 7)],
      [
        call('root', 'a', [1]),
        call('root', 'b', [1]),
        call('root', 'c', [1]),
        call('root', 'd', [1]),
        call('a', 'e', [3]),
        call('a', 'b', [3]),
      ],
    );
    const flow = flowOf(graph, 'root', 3);
    expect(flow.nodes.map((n) => n.name)).toEqual(['root', 'a', 'b']);
    expect(flow.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      `${id('root')}>${id('a')}`,
      `${id('root')}>${id('b')}`,
      `${id('a')}>${id('b')}`,
    ]);
    expect(flow.cut).toEqual([
      { from: id('root'), nodes: 2 },
      { from: id('a'), nodes: 1 },
    ]);
    expect(flow.hidden).toBe(3);
    // Edges to nodes not shown aren't in the pill.
    expect(flow.byProvenance.resolved).toBe(3);
  });

  it('ends on cycles and draws the edge back', () => {
    const graph = graphOf(
      [unit('root'), unit('a', 3)],
      [call('root', 'a', [1]), call('a', 'root', [4]), call('root', 'root', [2])],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.nodes).toHaveLength(2);
    expect(flow.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      `${id('root')}>${id('a')}`,
      `${id('root')}>${id('root')}`,
      `${id('a')}>${id('root')}`,
    ]);
  });

  it('starts only from a code unit the graph has', () => {
    const graph = graphOf(
      [unit('root'), decision('root', 1, 'ok', 2), unit('a', 5)],
      [
        branch('root', 'root?1', null, [2]),
        branch('root?1', 'a', 'yes', [3]),
        call('root', 'a', [3]),
      ],
    );
    const index = indexGraph(graph);
    expect(buildFlow(index, id('missing'))).toBeUndefined();
    expect(buildFlow(index, id('root?1'))).toBeUndefined();
  });

  it('keeps the first lines and unknown calls, and counts them all', () => {
    const many = Array.from({ length: 70 }, (_, i) => i + 2);
    const graph = graphOf(
      [unit('root'), unit('a', 100)],
      [
        call('root', 'a', many),
        ...many.map((line) => unknownCall('root', `f${String(line)}`, [line])),
      ],
    );
    const flow = flowOf(graph, 'root');
    expect(flow.edges[0]?.lines).toEqual(many.slice(0, FLOW_LIMITS.lines));
    expect(flow.edges[0]?.sites).toBe(70);
    expect(flow.unknown[0]?.total).toBe(70);
    expect(flow.unknown[0]?.calls).toHaveLength(FLOW_LIMITS.unknown);
    expect(flow.byProvenance.unknown).toBe(70);
  });
});

describe('indexGraph', () => {
  it('finds code units by the place of their name, not decisions', () => {
    const index = indexGraph(
      graphOf(
        [unit('root', 3), decision('root', 1, 'ok', 4), unit('a', 8)],
        [
          branch('root', 'root?1', null, [4]),
          branch('root?1', 'a', 'yes', [5]),
          call('root', 'a', [5]),
        ],
      ),
    );
    expect(index.byPlace.get(placeKey('src/a.ts', 3, 10))).toBe(id('root'));
    expect(index.byPlace.get(placeKey('src/a.ts', 4, 7))).toBeUndefined();
    expect(index.byPlace.size).toBe(2);
  });
});
