// A project's entry points as the panel lists them (phase 8, ADR 0030 §5): read from the graph's own nodes and their
// convention edges, worked out once per version and then sliced, so a page of them is answered at once.
import type { GraphIndex } from './flow.js';
import { ENTRY_KINDS, type EntryKind, type Place } from './model.js';

export interface EntryPointItem {
  /** Its node's id: a flow opens from it. */
  readonly id: string;
  readonly kind: EntryKind;
  readonly framework: string;
  readonly name: string;
  readonly place: Place | null;
  readonly complete: boolean;
  readonly why: string | null;
  /** For an element: the unit it's in. */
  readonly within: string | null;
  /** What handles it: a node of the graph, or (`id` null) code that isn't the project's, by its text; null for none. */
  readonly handler: {
    readonly id: string | null;
    readonly name: string;
    readonly place: Place | null;
  } | null;
  /** For a screen: how many elements the components it renders hold (`elementsByScreen`). */
  readonly elements?: number;
}

export type EntryPointLists = Readonly<Record<EntryKind, readonly EntryPointItem[]>>;

const byName = (a: EntryPointItem, b: EntryPointItem) =>
  a.name < b.name
    ? -1
    : a.name > b.name
      ? 1
      : (a.place?.path ?? '') < (b.place?.path ?? '')
        ? -1
        : (a.place?.path ?? '') > (b.place?.path ?? '')
          ? 1
          : (a.place?.line ?? 0) - (b.place?.line ?? 0);

/**
 * Each screen's elements (ADR 0030 §2): those in the code units its component renders, directly or through other
 * components (`renders` edges, through decisions too), in file and line order. A screen without a component found
 * has none.
 */
export function elementsByScreen(
  index: GraphIndex,
  screens: readonly EntryPointItem[],
  elements: readonly EntryPointItem[],
): ReadonlyMap<string, readonly EntryPointItem[]> {
  const byUnit = new Map<string, EntryPointItem[]>();
  for (const element of elements) {
    if (element.within === null) continue;
    byUnit.set(element.within, [...(byUnit.get(element.within) ?? []), element]);
  }
  const rendered = (start: string): Set<string> => {
    const seen = new Set([start]);
    const queue = [start];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const edge of index.out.get(id) ?? []) {
        if (edge.to === null || seen.has(edge.to)) continue;
        const toDecision = index.nodes.get(edge.to)?.kind === 'decision';
        if (edge.relation === 'renders' || toDecision) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return seen;
  };
  const found = new Map<string, readonly EntryPointItem[]>();
  for (const screen of screens) {
    const component = screen.handler?.id;
    if (component == null) continue;
    const mine = [...rendered(component)].flatMap((unit) => byUnit.get(unit) ?? []);
    mine.sort(
      (a, b) =>
        (a.place?.path ?? '').localeCompare(b.place?.path ?? '') ||
        (a.place?.line ?? 0) - (b.place?.line ?? 0) ||
        (a.place?.column ?? 0) - (b.place?.column ?? 0),
    );
    found.set(screen.id, mine);
  }
  return found;
}

/** Every entry point, by kind, each kind in name order (then file and line), with what handles it. */
export function listEntryPoints(index: GraphIndex): EntryPointLists {
  const lists = Object.fromEntries(
    ENTRY_KINDS.map((kind) => [kind, [] as EntryPointItem[]]),
  ) as Record<EntryKind, EntryPointItem[]>;
  for (const node of index.nodes.values()) {
    if (node.kind !== 'entry-point' || node.entry === undefined) continue;
    const edge = index.out.get(node.id)?.[0];
    const target = edge?.to == null ? undefined : index.nodes.get(edge.to);
    lists[node.entry.kind].push({
      id: node.id,
      kind: node.entry.kind,
      framework: node.entry.framework,
      name: node.name,
      place: node.place,
      complete: node.entry.complete,
      why: node.entry.why,
      within: node.entry.within,
      handler:
        edge === undefined
          ? null
          : target !== undefined
            ? { id: target.id, name: target.name, place: target.place }
            : { id: null, name: edge.target ?? '', place: null },
    });
  }
  for (const kind of ENTRY_KINDS) lists[kind].sort(byName);
  // Each screen says how many elements it has; they're asked for a screen at a time.
  const byScreen = elementsByScreen(index, lists.screen, lists.element);
  lists.screen = lists.screen.map((screen) => ({
    ...screen,
    elements: byScreen.get(screen.id)?.length ?? 0,
  }));
  return lists;
}
