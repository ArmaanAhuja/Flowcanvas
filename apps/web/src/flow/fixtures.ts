// Flows for the layout's tests and its performance test (phase 7): shaped like the engine's answers.
import type { FlowResult } from '@flowcanvas/engine/protocol';

export type Flow = NonNullable<FlowResult['flow']>;
export const place = (line: number) => ({ path: 'src/send.ts', line, column: 17 });
export const unit = (name: string, line: number) => ({
  id: `src/send.ts#${name}`,
  kind: 'code-unit' as const,
  name,
  place: place(line),
  unit: 'function' as const,
  change: 'unchanged' as const,
});
export const decision = (n: number, condition: string, line: number) => ({
  id: `src/send.ts#send?${String(n)}`,
  kind: 'decision' as const,
  name: condition,
  place: place(line),
  unit: null,
  change: 'unchanged' as const,
});
export const edge = (from: string, to: string, label: string | null = null) => ({
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
export const small: Flow = {
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

/** A flow at the 60-node cap: a tree of calls, some shared, one node in eight a decision, unknown groups and a cut. */
export function capFlow(): Flow {
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
  return {
    ...small,
    root: 'src/send.ts#n0',
    nodes,
    edges,
    unknown: [1, 4, 9].map((i) => ({ from: `src/send.ts#n${String(i)}`, total: i, calls: [] })),
    cut: [{ from: 'src/send.ts#n19', nodes: 12 }],
  };
}
