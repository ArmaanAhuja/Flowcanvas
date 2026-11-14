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
  return lists;
}
