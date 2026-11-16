// The sequence view on the page (phase 13): the flow in the code's order, nested, with branches, failure paths only
// from the code's error branches, open ends, and each hand-off's work after the main steps.
import type { FlowResult } from '@flowcanvas/engine/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEQUENCE_UNTIMED, SequenceCanvas, flowToSequence } from './SequenceCanvas';

type Flow = NonNullable<FlowResult['flow']>;
type Node = Flow['nodes'][number];
type Edge = Flow['edges'][number];

afterEach(cleanup);

const fn = (path: string, name: string, line = 1): Node => ({
  id: `${path}#${name}`,
  kind: 'code-unit',
  name,
  place: { path, line, column: 1 },
  unit: 'function',
  change: 'unchanged',
});
const call = (from: string, to: string, line: number, extra: Partial<Edge> = {}): Edge => ({
  from,
  to,
  kind: 'call',
  relation: 'calls',
  label: null,
  provenance: 'resolved',
  lines: [line],
  sites: 1,
  ...extra,
});

const root = fn('src/send.ts', 'send', 10);
const check = fn('src/check.ts', 'check');
const save = fn('src/save.ts', 'save');
const audit = fn('src/audit.ts', 'audit');
// Named "error", but on no error branch: not a failure path (a name is never evidence).
const errorText = fn('src/text.ts', 'errorText');
const decision: Node = {
  id: 'src/send.ts#send?1',
  kind: 'decision',
  name: '!user',
  place: { path: 'src/send.ts', line: 12, column: 3 },
  unit: null,
  change: 'unchanged',
};
const recover = fn('src/recover.ts', 'recover');
const handoff: Node = {
  id: '(handoff queue:email-queue/EmailSenderJob)',
  kind: 'async-handoff',
  name: 'email-queue · EmailSenderJob',
  place: null,
  unit: null,
  change: 'unchanged',
  handoff: { kind: 'queue', library: 'message-queue', name: 'x', complete: true, why: null },
};
const worker = fn('src/job.ts', 'handle');
const deliver = fn('src/deliver.ts', 'deliver');

const FLOW: Flow = {
  root: root.id,
  nodes: [root, save, check, decision, audit, errorText, recover, handoff, worker, deliver],
  edges: [
    // Breadth-first would give save before check; the code calls check first (line 11).
    call(root.id, save.id, 20),
    call(root.id, check.id, 11),
    call(root.id, decision.id, 12, { kind: 'branch', relation: null }),
    call(decision.id, errorText.id, 13, { label: 'yes' }),
    call(save.id, audit.id, 5),
    call(root.id, recover.id, 30, { label: 'error' }),
    call(root.id, handoff.id, 25, { kind: 'handoff', relation: null, provenance: 'convention' }),
    call(handoff.id, worker.id, 1, { kind: 'handoff', relation: null, provenance: 'convention' }),
    call(worker.id, deliver.id, 3),
  ],
  unknown: [{ from: save.id, total: 2, calls: [] }],
  cut: [],
  hidden: 0,
  byProvenance: { observed: 0, resolved: 7, convention: 2, suggested: 0, unknown: 2 },
} as Flow;

describe('flowToSequence', () => {
  const sequence = flowToSequence(FLOW);
  const rows = sequence.mainSteps.map((s) => [s.name, s.depth, s.branch ?? null, s.span]);

  it('orders steps as the code calls them, depth first, nested, each spanning what it calls', () => {
    expect(rows).toEqual([
      ['send', 0, null, 9],
      ['check', 1, null, 1],
      ['!user', 1, null, 2],
      ['errorText', 2, 'yes', 1],
      ['save', 1, null, 3],
      ['audit', 2, null, 1],
      ['2 unknown calls', 2, null, 1],
      ['email-queue · EmailSenderJob', 1, null, 1],
      ['recover', 1, 'error', 1],
    ]);
  });

  it('marks a failure path only where the code has an error branch', () => {
    const failures = sequence.mainSteps.filter((s) => s.failure === true).map((s) => s.name);
    expect(failures).toEqual(['recover']);
  });

  it('puts each hand-off’s work after the main steps, in its own Background group', () => {
    expect(
      sequence.background.map((b) => [b.title, b.steps.map((s) => [s.name, s.depth])]),
    ).toEqual([
      [
        'Background · email-queue · EmailSenderJob',
        [
          ['handle', 0],
          ['deliver', 1],
        ],
      ],
    ]);
    // On the order axis, after the main rows.
    expect(sequence.background[0]?.steps[0]?.order).toBe(sequence.mainSteps.length);
    expect(sequence.subtitle).toBe(SEQUENCE_UNTIMED);
  });

  it('never times a step: nothing is measured from the code', () => {
    const all = [...sequence.mainSteps, ...sequence.background.flatMap((b) => b.steps)];
    expect(all.some((s) => s.start !== undefined || s.duration !== undefined)).toBe(false);
  });
});

describe('SequenceCanvas', () => {
  const ready = (flow: Flow | null) =>
    ({
      kind: 'ready',
      result: {
        version: 'a'.repeat(64),
        complete: true,
        current: true,
        flow,
        message: flow === null ? 'No flow from there.' : null,
        takenAt: '2026-11-16T00:00:00.000Z',
      },
      laid: null,
    }) as const;

  it('selects a row’s node for the inspector, as the graph does; an open end isn’t a step', () => {
    const onSelectNode = vi.fn();
    render(<SequenceCanvas flow={ready(FLOW)} selected={null} onSelectNode={onSelectNode} />);
    fireEvent.click(screen.getByRole('button', { name: /^check,/ }));
    expect(onSelectNode).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: check.id, type: 'flow' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^!user/ }));
    expect(onSelectNode).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: decision.id, type: 'decision' }),
    );
    expect(screen.queryByRole('button', { name: /unknown calls/ })).toBeNull();
    expect(screen.getByText('2 unknown calls')).toBeTruthy();
    const background = screen.getByRole('group', {
      name: 'Background · email-queue · EmailSenderJob',
    });
    expect(within(background).getByText('deliver')).toBeTruthy();
  });

  it('says why there’s nothing to show', () => {
    render(<SequenceCanvas flow={ready(null)} selected={null} onSelectNode={vi.fn()} />);
    expect(screen.getByText('No flow from there.')).toBeTruthy();
  });
});
