import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareFlow, flowLines, type FlowLabel, type FlowLike } from './flows.js';

// `if (ok) save()` in show, show calling load always, and two unknown calls, one of them under the decision.
const flow: FlowLike = {
  root: 'a.ts#show',
  nodes: [
    { id: 'a.ts#show', kind: 'code-unit', name: 'show', place: { path: 'src/a.ts', line: 3 } },
    { id: 'a.ts#show?1', kind: 'decision', name: 'ok', place: { path: 'src/a.ts', line: 5 } },
    { id: 'b.ts#load', kind: 'code-unit', name: 'load', place: { path: 'lib/b.ts', line: 9 } },
    { id: 'a.ts#save', kind: 'code-unit', name: 'save', place: { path: 'src/a.ts', line: 20 } },
  ],
  edges: [
    { from: 'a.ts#show', to: 'a.ts#show?1', kind: 'branch', label: null },
    { from: 'a.ts#show', to: 'b.ts#load', kind: 'call', label: null },
    { from: 'a.ts#show?1', to: 'a.ts#save', kind: 'branch', label: 'yes' },
  ],
  unknown: [
    {
      from: 'a.ts#show',
      total: 2,
      calls: [
        { target: 'prisma.poll.create', label: null },
        { target: 'log', label: null },
      ],
    },
    { from: 'a.ts#show?1', total: 1, calls: [{ target: 'notify', label: 'yes' }] },
  ],
  cut: [{ from: 'b.ts#load', nodes: 4 }],
};

const label = (lines: readonly string[]): FlowLabel => ({
  name: 'show',
  case: 'test',
  path: 'src/a.ts',
  line: 3,
  column: 14,
  lines,
});

describe('flowLines', () => {
  it('writes each node with its file and line, each edge with its outcome, unknown calls and cuts, sorted', () => {
    expect(flowLines(flow)).toEqual([
      'branch if ok (a.ts:5) -> save (a.ts:20) [yes]',
      'branch show (a.ts:3) -> if ok (a.ts:5)',
      'call show (a.ts:3) -> load (b.ts:9)',
      'cut load (b.ts:9): 4',
      'node if ok (a.ts:5)',
      'node load (b.ts:9)',
      'node save (a.ts:20)',
      'node show (a.ts:3)',
      'unknown from if ok (a.ts:5): 1: notify [yes]',
      'unknown from show (a.ts:3): 2: log, prisma.poll.create',
    ]);
  });
});

describe('compareFlow', () => {
  it('agrees with a label in any order', () => {
    expect(compareFlow(label([...flowLines(flow)].reverse()), flow)).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('says what the label has that the flow lacks, and the other way round, line by line', () => {
    const lines = flowLines(flow).filter((line) => !line.startsWith('call '));
    lines.push('node never (a.ts:99)');
    expect(compareFlow(label(lines), flow)).toEqual({
      missing: ['node never (a.ts:99)'],
      extra: ['call show (a.ts:3) -> load (b.ts:9)'],
    });
  });
});

describe('labels/flows.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('../labels/flows.json', import.meta.url), 'utf8'),
  ) as { documenso: FlowLabel[] };

  it('holds the plan’s 10 Documenso functions, each with its root node and nothing listed twice', () => {
    expect(file.documenso).toHaveLength(10);
    for (const one of file.documenso) {
      const root = `node ${one.name} (${one.path.slice(one.path.lastIndexOf('/') + 1)}:${String(one.line)})`;
      expect(one.lines, one.name).toContain(root);
      expect(new Set(one.lines).size, one.name).toBe(one.lines.length);
      expect([...one.lines].sort(), one.name).toEqual(one.lines);
    }
  });
});
