// Phase 5's Done when: the engine's callers and callees for the hand-labelled functions (labels/calls.json), compared
// with the labels exactly: every caller with the lines it calls from, every callee with how it's known, where it's
// declared and the lines it's called on. Shapes are structural, so the corpus package doesn't depend on the engine.

export interface Place {
  readonly path: string;
  readonly line: number;
}

/** A caller or callee as the engine answers it (@flowcanvas/engine's CallEntry). */
export interface AnsweredEntry {
  readonly name: string;
  readonly relation: string;
  readonly provenance: string;
  readonly builtIn: boolean;
  readonly place: Place | null;
  readonly sites: readonly Place[];
}

export interface CallerLabel {
  readonly name: string;
  readonly relation: string;
  /** The caller's file: where its calls are. */
  readonly path: string;
  readonly lines: readonly number[];
}

export interface CalleeLabel {
  readonly name: string;
  readonly relation: string;
  readonly provenance: string;
  readonly builtIn: boolean;
  /** `path:line` of its declaration, or null (unresolved, or built in). */
  readonly place: string | null;
  /** Lines in the labelled function where it's called. */
  readonly lines: readonly number[];
}

export interface CallsLabel {
  readonly name: string;
  readonly case: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly callers: readonly CallerLabel[];
  readonly callees: readonly CalleeLabel[];
}

export interface Difference {
  /** In the labels, not in the answer. */
  readonly missing: readonly string[];
  /** In the answer, not in the labels. */
  readonly extra: readonly string[];
}

// Sorted, never deduplicated: a call listed twice is a difference (found by this check, phase 5).
const lines = (values: readonly number[]) => [...values].sort((a, b) => a - b).join(',');

export const callerLine = (c: CallerLabel): string =>
  `${c.relation} ${c.name} @ ${c.path}:${lines(c.lines)}`;

export const calleeLine = (c: CalleeLabel): string =>
  `${c.provenance} ${c.relation} ${c.name}${c.builtIn ? ' (built-in)' : ''} -> ${c.place ?? '-'} @ ${lines(c.lines)}`;

/** A caller's calls are all in its own file: one line per caller, with every line it calls from. */
export function answeredCallers(entries: readonly AnsweredEntry[]): string[] {
  return entries.map((e) =>
    callerLine({
      name: e.name,
      relation: e.relation,
      path: e.sites[0]?.path ?? e.place?.path ?? '?',
      lines: e.sites.map((s) => s.line),
    }),
  );
}

export function answeredCallees(entries: readonly AnsweredEntry[]): string[] {
  return entries.map((e) =>
    calleeLine({
      name: e.name,
      relation: e.relation,
      provenance: e.provenance,
      builtIn: e.builtIn,
      place: e.place === null ? null : `${e.place.path}:${String(e.place.line)}`,
      lines: e.sites.map((s) => s.line),
    }),
  );
}

/** Exact comparison, as multisets: two callers can share a name and a file only if the labels say so. */
export function difference(expected: readonly string[], answered: readonly string[]): Difference {
  const left = [...answered];
  const missing: string[] = [];
  for (const line of expected) {
    const at = left.indexOf(line);
    if (at === -1) missing.push(line);
    else left.splice(at, 1);
  }
  return { missing: missing.sort(), extra: left.sort() };
}

/** Both views of one labelled function: empty lists when the answer matches the labels. */
export function compareCalls(
  label: CallsLabel,
  callers: readonly AnsweredEntry[],
  callees: readonly AnsweredEntry[],
): { readonly callers: Difference; readonly callees: Difference } {
  return {
    callers: difference(label.callers.map(callerLine), answeredCallers(callers)),
    callees: difference(label.callees.map(calleeLine), answeredCallees(callees)),
  };
}

// Phase 6's hand-checked samples: the flow graph held to the same labels as the Calls tab (labels/calls.json) and to
// labels/graph.json, by turning a labelled function's node and its edges into the Calls tab's entries and comparing
// them exactly. Built-ins aren't in the graph (owner, 12 Nov 2026), so they're set aside from the labels. Here, not in
// a module of its own: this file has no imports, so the workspace host's tests can import it as it is.

interface GraphPlace {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}
export interface LabelGraph {
  readonly nodes: readonly {
    readonly id: string;
    readonly name: string;
    readonly place: GraphPlace | null;
  }[];
  readonly edges: readonly {
    /** Calls only are compared; a decision's branches (phase 7) repeat calls already there. */
    readonly kind?: string;
    readonly from: string;
    readonly to: string | null;
    readonly target: string | null;
    readonly relation: string | null;
    readonly provenance: string;
    readonly lines: readonly number[];
  }[];
}

export interface GraphCheck {
  /** The labelled function's node; null when the graph has none at its place. */
  readonly node: string | null;
  readonly callers: Difference;
  readonly callees: Difference;
}

/** The labelled function in the graph, compared with its labels: its node, who reaches it, and what it reaches. */
export function checkGraph(graph: LabelGraph, label: CallsLabel): GraphCheck {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = graph.nodes.find(
    (n) =>
      n.place?.path === label.path &&
      n.place.line === label.line &&
      n.place.column === label.column,
  );
  const withoutBuiltIns: CallsLabel = {
    ...label,
    callees: label.callees.filter((c) => !c.builtIn),
  };
  if (node === undefined) {
    return { node: null, ...compareCalls(withoutBuiltIns, [], []) };
  }
  const entry = (
    name: string,
    relation: string | null,
    provenance: string,
    place: GraphPlace | null,
    sitesIn: string,
    lines: readonly number[],
  ): AnsweredEntry => ({
    name,
    relation: relation ?? 'calls',
    // The graph's unknown is the Calls tab's unresolved (decisions log, 12 Nov 2026).
    provenance: provenance === 'unknown' ? 'unresolved' : provenance,
    builtIn: false,
    place: place === null ? null : { path: place.path, line: place.line },
    sites: lines.map((line) => ({ path: sitesIn, line })),
  });
  const calls = graph.edges.filter((e) => (e.kind ?? 'call') === 'call');
  const callees = calls
    .filter((e) => e.from === node.id)
    .map((e) => {
      const to = e.to === null ? undefined : byId.get(e.to);
      return entry(
        to?.name ?? e.target ?? '?',
        e.relation,
        e.provenance,
        to?.place ?? null,
        label.path,
        e.lines,
      );
    });
  const callers = calls
    .filter((e) => e.to === node.id)
    .map((e) => {
      const from = byId.get(e.from);
      return entry(
        from?.name ?? '?',
        e.relation,
        e.provenance,
        null,
        from?.place?.path ?? '?',
        e.lines,
      );
    });
  return { node: node.id, ...compareCalls(withoutBuiltIns, callers, callees) };
}
