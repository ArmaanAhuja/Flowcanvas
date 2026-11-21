// The sequence view on the page (phase 13): the same flow as the graph, as a waterfall (Figma 08). The order is the
// code's: from the root, depth first, each function's calls in the order of their lines. A decision's branches are
// said on the rows they lead to; a catch's is a failure path; open ends (unknown calls, what isn't shown) are rows of
// their own, as stubs on the graph. Each hand-off's work follows the main steps in a Background group. Without a run
// (phase 29) there are no timings, and the view says so.
import type { FlowResult } from '@flowcanvas/engine/protocol';
import { SequenceView, type SequenceBackgroundSection, type SequenceStep } from '@flowcanvas/ui';
import { useMemo, type ReactNode } from 'react';
import type { CanvasNode } from '../canvas/FlowCanvas';
import { backgroundOf, cardOf } from '../flow/layout';
import type { FlowState } from '../flow/useFlow';
import styles from './SequenceCanvas.module.css';

type Flow = NonNullable<FlowResult['flow']>;
type Edge = Flow['edges'][number];

export const SEQUENCE_UNTIMED = 'order from code; no timings yet';

export interface FlowSequence {
  readonly title: string;
  readonly subtitle: string;
  readonly mainSteps: SequenceStep[];
  readonly background: SequenceBackgroundSection[];
}

/** An edge's place in its caller: its first line (an edge with none comes last, in the flow's order). */
const lineOf = (edge: Edge) => edge.lines[0] ?? Number.MAX_SAFE_INTEGER;

/** The flow as rows, in the code's order (see the file's comment). Pure: tested on its own. */
export function flowToSequence(flow: Flow): FlowSequence {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const out = new Map<string, Edge[]>();
  for (const edge of flow.edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  for (const edges of out.values()) edges.sort((a, b) => lineOf(a) - lineOf(b));
  const open = new Map<string, { unknown: number; more: number }>();
  for (const group of flow.unknown) {
    open.set(group.from, { unknown: group.total, more: open.get(group.from)?.more ?? 0 });
  }
  for (const cut of flow.cut) {
    open.set(cut.from, { unknown: open.get(cut.from)?.unknown ?? 0, more: cut.nodes });
  }
  const background = backgroundOf(flow);
  const seen = new Set<string>();
  const handoffs: string[] = [];

  /** Rows from `id` down, depth first; each node once (the first time the code reaches it). */
  const walk = (
    id: string,
    depth: number,
    via: Edge | null,
    rows: SequenceStep[],
    inBackground: boolean,
  ) => {
    const node = byId.get(id);
    if (node === undefined || seen.has(id)) return;
    seen.add(id);
    const at = rows.length;
    const failure = via?.label === 'error';
    rows.push({
      id,
      name: node.name,
      location: cardOf(node).location,
      depth,
      branch: via?.label ?? null,
      ...(failure ? { failure } : {}),
      order: at,
      span: 1,
    });
    if (node.kind === 'async-handoff') handoffs.push(id);
    for (const edge of out.get(id) ?? []) {
      // What a hand-off leads to runs later, in the background, after the main steps.
      if (node.kind === 'async-handoff' && !inBackground) continue;
      if (background.has(edge.to) !== inBackground) continue;
      walk(edge.to, depth + 1, edge, rows, inBackground);
    }
    const ends = open.get(id);
    if (ends !== undefined && ends.unknown > 0) {
      rows.push({
        id: `${id}::unknown`,
        name: `${String(ends.unknown)} unknown ${ends.unknown === 1 ? 'call' : 'calls'}`,
        depth: depth + 1,
        stub: true,
        order: rows.length,
        span: 1,
      });
    }
    if (ends !== undefined && ends.more > 0) {
      rows.push({
        id: `${id}::more`,
        name: `${String(ends.more)} more ${ends.more === 1 ? 'call' : 'calls'} not shown`,
        depth: depth + 1,
        stub: true,
        order: rows.length,
        span: 1,
      });
    }
    // Its bar covers what it calls, as a trace's parent span does.
    const self = rows[at];
    if (self !== undefined) rows[at] = { ...self, span: rows.length - at };
  };

  const mainSteps: SequenceStep[] = [];
  walk(flow.root, 0, null, mainSteps, false);
  const sections: SequenceBackgroundSection[] = [];
  let order = mainSteps.length;
  // A hand-off found in the background is walked too: the array's iterator sees what's added as it goes.
  for (const id of handoffs) {
    const handoff = byId.get(id);
    if (handoff === undefined) continue;
    const rows: SequenceStep[] = [];
    for (const edge of out.get(handoff.id) ?? []) {
      if (background.has(edge.to)) walk(edge.to, 0, null, rows, true);
    }
    if (rows.length === 0) continue;
    // Background rows follow the main ones on the order axis.
    sections.push({
      id: handoff.id,
      title: `Background · ${handoff.name}`,
      steps: rows.map((row) => ({ ...row, order: row.order + order })),
    });
    order += rows.length;
  }
  return {
    title: byId.get(flow.root)?.name ?? flow.root,
    subtitle: SEQUENCE_UNTIMED,
    mainSteps,
    background: sections,
  };
}

export interface SequenceCanvasProps {
  readonly index?: ReactNode;
  readonly flow: FlowState;
  readonly selected: CanvasNode | null;
  readonly onSelectNode: (node: CanvasNode | null) => void;
}

/** A row chosen: the inspector shows its node, as a click on the graph does. */
function canvasNodeOf(flow: Flow, id: string): CanvasNode | null {
  const node = flow.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  if (node.kind === 'decision') {
    return {
      id,
      type: 'decision',
      position: { x: 0, y: 0 },
      data: { condition: node.name, id, place: node.place },
    };
  }
  const { kind, location } = cardOf(node);
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    data: { id, title: node.name, location, kind, place: node.place },
  };
}

export function SequenceCanvas({ index, flow, selected, onSelectNode }: SequenceCanvasProps) {
  const shown = flow.kind === 'ready' ? flow.result.flow : null;
  const sequence = useMemo(() => (shown === null ? null : flowToSequence(shown)), [shown]);
  const said =
    flow.kind === 'loading'
      ? 'Building the flow…'
      : flow.kind === 'problem'
        ? flow.message
        : flow.kind === 'ready' && flow.result.flow === null
          ? (flow.result.message ?? 'There’s no flow to show from there.')
          : 'Choose a function to see its flow in order: right-click its name in the Code view and choose Show flow, or find it with Search.';
  return (
    <div className={styles.canvas}>
      {index !== undefined && <div className={styles.index}>{index}</div>}
      {sequence === null || shown === null ? (
        <p className={styles.empty} role="status">
          {said}
        </p>
      ) : (
        <SequenceView
          title={sequence.title}
          subtitle={sequence.subtitle}
          mainSteps={sequence.mainSteps}
          background={sequence.background}
          selectedId={selected?.id ?? null}
          onSelectStep={(id) => {
            onSelectNode(canvasNodeOf(shown, id));
          }}
        />
      )}
    </div>
  );
}
