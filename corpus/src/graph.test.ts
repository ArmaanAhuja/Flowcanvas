import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGraph, type CallsLabel, type LabelGraph } from './calls.ts';

const label: CallsLabel = {
  name: 'createPoll',
  case: 'test',
  path: 'src/poll.ts',
  line: 3,
  column: 14,
  callers: [
    { name: 'route.ts (top level)', relation: 'calls', path: 'src/route.ts', lines: [4, 9] },
  ],
  callees: [
    {
      name: 'save',
      relation: 'calls',
      provenance: 'resolved',
      builtIn: false,
      place: 'src/db.ts:2',
      lines: [5],
    },
    {
      name: 'tx.poll.create',
      relation: 'calls',
      provenance: 'unresolved',
      builtIn: false,
      place: null,
      lines: [6],
    },
    // Not in the graph: set aside.
    {
      name: 'some',
      relation: 'calls',
      provenance: 'resolved',
      builtIn: true,
      place: null,
      lines: [4],
    },
  ],
};

const place = (path: string, line: number, column = 1) => ({ path, line, column });
const graph: LabelGraph = {
  nodes: [
    { id: 'src/poll.ts#createPoll', name: 'createPoll', place: place('src/poll.ts', 3, 14) },
    { id: 'src/db.ts#save', name: 'save', place: place('src/db.ts', 2) },
    {
      id: 'src/route.ts#(top level)',
      name: 'route.ts (top level)',
      place: place('src/route.ts', 1),
    },
  ],
  edges: [
    {
      from: 'src/route.ts#(top level)',
      to: 'src/poll.ts#createPoll',
      target: null,
      relation: 'calls',
      provenance: 'resolved',
      lines: [4, 9],
    },
    {
      from: 'src/poll.ts#createPoll',
      to: 'src/db.ts#save',
      target: null,
      relation: 'calls',
      provenance: 'resolved',
      lines: [5],
    },
    {
      from: 'src/poll.ts#createPoll',
      to: null,
      target: 'tx.poll.create',
      relation: 'calls',
      provenance: 'unknown',
      lines: [6],
    },
  ],
};
const none = { missing: [], extra: [] };

describe('checkGraph', () => {
  it('matches a graph that has the labelled node, its callers and its callees (built-ins aside)', () => {
    expect(checkGraph(graph, label)).toEqual({
      node: 'src/poll.ts#createPoll',
      callers: none,
      callees: none,
    });
  });

  it('compares calls only: a decision’s branches repeat calls already there (phase 7)', () => {
    const withBranches: LabelGraph = {
      nodes: [
        ...graph.nodes,
        { id: 'src/poll.ts#createPoll?1', name: 'draft', place: place('src/poll.ts', 4) },
      ],
      edges: [
        ...graph.edges,
        {
          kind: 'branch',
          from: 'src/poll.ts#createPoll',
          to: 'src/poll.ts#createPoll?1',
          target: null,
          relation: null,
          provenance: 'resolved',
          lines: [4],
        },
        {
          kind: 'branch',
          from: 'src/poll.ts#createPoll?1',
          to: 'src/db.ts#save',
          target: null,
          relation: 'calls',
          provenance: 'resolved',
          lines: [5],
        },
      ],
    };
    expect(checkGraph(withBranches, label)).toEqual({
      node: 'src/poll.ts#createPoll',
      callers: none,
      callees: none,
    });
  });

  it('says what differs: no node at the place, a missing caller, an edge drawn as resolved when it isn’t', () => {
    expect(checkGraph({ nodes: [], edges: [] }, label)).toMatchObject({
      node: null,
      callers: { missing: ['calls route.ts (top level) @ src/route.ts:4,9'], extra: [] },
    });
    const wrong: LabelGraph = {
      nodes: [...graph.nodes, { id: 'x#tx', name: 'tx.poll.create', place: place('x.ts', 1) }],
      edges: [
        {
          from: 'src/poll.ts#createPoll',
          to: 'src/db.ts#save',
          target: null,
          relation: 'calls',
          provenance: 'resolved',
          lines: [5],
        },
        {
          from: 'src/poll.ts#createPoll',
          to: 'x#tx',
          target: null,
          relation: 'calls',
          provenance: 'resolved',
          lines: [6],
        },
      ],
    };
    const result = checkGraph(wrong, label);
    expect(result.callers.missing).toHaveLength(1);
    expect(result.callees).toEqual({
      missing: ['unresolved calls tx.poll.create -> - @ 6'],
      extra: ['resolved calls tx.poll.create -> x.ts:1 @ 6'],
    });
  });
});

describe('labels/graph.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('../labels/graph.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

  it('labels three functions in each of the two forks phase 5 didn’t, none in an enterprise part', () => {
    for (const repo of ['librechat', 'twenty']) {
      const labels = file[repo] as CallsLabel[];
      expect(labels).toHaveLength(3);
      for (const l of labels) {
        expect(l.case.length).toBeGreaterThan(0);
        expect(l.callers.length + l.callees.length).toBeGreaterThan(0);
        for (const c of l.callees) {
          if (c.provenance === 'unresolved' || c.builtIn) expect(c.place).toBeNull();
          else expect(c.place).toMatch(/^[^:]+:\d+$/);
        }
      }
    }
  });
});
