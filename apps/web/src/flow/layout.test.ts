// @vitest-environment node
import type { FlowResult } from '@flowcanvas/engine/protocol';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { SIZES, layoutFlow } from './layout';

type Flow = NonNullable<FlowResult['flow']>;
const place = (line: number) => ({ path: 'src/send.ts', line, column: 17 });
const unit = (name: string, line: number) => ({
  id: `src/send.ts#${name}`,
  kind: 'code-unit' as const,
  name,
  place: place(line),
  unit: 'function' as const,
  change: 'unchanged' as const,
});
const decision = (n: number, condition: string, line: number) => ({
  id: `src/send.ts#send?${String(n)}`,
  kind: 'decision' as const,
  name: condition,
  place: place(line),
  unit: null,
  change: 'unchanged' as const,
});
const edge = (from: string, to: string, label: string | null = null) => ({
  from: `src/send.ts#${from}`,
  to: `src/send.ts#${to}`,
  kind: label === null && !to.includes('?') ? ('call' as const) : ('branch' as const),
  relation: 'calls' as const,
  label,
  provenance: 'resolved' as const,
  lines: [3],
  sites: 1,
});
const none = { observed: 0, resolved: 0, convention: 0, suggested: 0, unknown: 0 };

// send: if (draft) save() else notify(); try { load() } catch { report() }; and 2 unknown calls.
const small: Flow = {
  root: 'src/send.ts#send',
  nodes: [
    unit('send', 1),
    decision(1, 'draft', 2),
    decision(2, 'on error', 6),
    unit('load', 20),
    unit('save', 30),
    unit('notify', 40),
    unit('report', 50),
  ],
  edges: [
    edge('send', 'send?1'),
    edge('send', 'send?2'),
    edge('send', 'load'),
    edge('send?1', 'save', 'yes'),
    edge('send?1', 'notify', 'no'),
    edge('send?2', 'report', 'error'),
  ],
  unknown: [{ from: 'src/send.ts#send', total: 2, calls: [] }],
  cut: [],
  hidden: 0,
  byProvenance: { ...none, resolved: 5, unknown: 2 },
};

const boxes = (laid: Awaited<ReturnType<typeof layoutFlow>>) =>
  laid.nodes.map((node) => ({
    id: node.id,
    ...node.position,
    width: node.type === 'flow' ? SIZES.node.width : 40,
    height: node.type === 'flow' ? SIZES.node.height : 16,
  }));

describe('layoutFlow', () => {
  it('lays a flow out top to bottom, each node below what calls it, stubs below their node', async () => {
    const laid = await layoutFlow(small, new ELK());
    const y = new Map(laid.nodes.map((node) => [node.id, node.position.y]));
    for (const e of laid.edges) {
      expect(y.get(e.target), `${e.source} → ${e.target}`).toBeGreaterThan(
        y.get(e.source) ?? Infinity,
      );
    }
    expect(laid.nodes.map((n) => n.type).sort()).toEqual(
      ['decision', 'decision', 'flow', 'flow', 'flow', 'flow', 'flow', 'stub'].sort(),
    );
    const stub = laid.nodes.find((n) => n.type === 'stub');
    expect(stub?.data).toEqual({ from: 'src/send.ts#send', variant: 'unknown', count: 2 });
    // The catch's outcome is a failure path; a stub's edge has no arrow.
    expect(laid.edges.find((e) => e.data.label === 'error')?.data.failure).toBe(true);
    expect(laid.edges.find((e) => e.target === stub?.id)?.data).toMatchObject({
      stub: true,
      provenance: 'unknown',
    });
    expect(laid.nodes.find((n) => n.id === 'src/send.ts#save')?.data).toMatchObject({
      title: 'save',
      location: 'src/send.ts:30',
      kind: 'function',
    });
  });

  it('lays a flow at the 60-node cap out without overlaps, in well under a second', async () => {
    // A tree of calls, some shared, one node in eight a decision, unknown groups and cuts: the shape the spike timed.
    const nodes: Flow['nodes'][number][] = [unit('n0', 1)];
    const names = ['n0'];
    const edges: Flow['edges'][number][] = [];
    for (let i = 1; i < 60; i += 1) {
      const parent = names[Math.floor((i - 1) / 3)] ?? 'n0';
      const name = i % 8 === 0 ? `send?${String(i)}` : `n${String(i)}`;
      names.push(name);
      nodes.push(
        i % 8 === 0
          ? decision(i, `options.mode === Mode.Variant${String(i)} && flags.enabled`, i)
          : unit(name, i),
      );
      edges.push(edge(parent, name, parent.includes('?') ? 'yes' : null));
      if (i % 7 === 0 && i % 8 !== 0) edges.push(edge(names[i - 5] ?? 'n0', name));
    }
    const big: Flow = {
      ...small,
      root: 'src/send.ts#n0',
      nodes,
      edges,
      unknown: [1, 4, 9].map((i) => ({ from: `src/send.ts#n${String(i)}`, total: i, calls: [] })),
      cut: [{ from: 'src/send.ts#n19', nodes: 12 }],
    };
    const started = performance.now();
    const laid = await layoutFlow(big, new ELK());
    const ms = performance.now() - started;
    expect(laid.nodes).toHaveLength(64);
    const placed = boxes(laid);
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
    console.log(`60-node flow laid out in ${String(Math.round(ms))} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
