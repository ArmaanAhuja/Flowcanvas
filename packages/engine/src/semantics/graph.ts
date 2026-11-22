// The flow graph from its files' parts (ADR 0027): one graph, each node once, a file's own nodes over the targets
// recorded where they're called.
import {
  elementsByScreen,
  indexGraph,
  listEntryPoints,
  type EntryPointItem,
  type EntryPointLists,
  type Graph,
  type GraphNode,
} from '@flowcanvas/graph-model';
import { joinEntries, type FileEntries, type Located } from './entry-pass.js';
import type { FileGraph } from './graph-pass.js';
import { joinConnections, type FileConnections } from './connection-pass.js';

/** A file's part as the pass holds it: its graph, and its entry points to join (phase 8). */
export interface PassFile extends FileGraph {
  readonly entries?: FileEntries;
  /** Its links to the app's API and its hand-offs' receivers, to join (phases 9 to 11). */
  readonly connections?: FileConnections;
}

/** Questions get a turn this often during a pass. */
export const GRAPH_FILES_BETWEEN_PAUSES = 25;
/** Above this share of the worker's heap, even after releasing services, the pass stops and says it's partial. */
export const GRAPH_HEAP_SHARE = 0.9;

export const GRAPH_MESSAGES = {
  partial: 'This project is too large to analyse whole here: the graph covers part of it.',
} as const;

export interface GraphPass {
  readonly graph: Graph;
  /** Source files walked. */
  readonly files: number;
  readonly builtInCalls: number;
  readonly complete: boolean;
  readonly note: string | null;
}

export function assemble(
  files: ReadonlyMap<string, PassFile>,
  complete: boolean,
  scripts: readonly Located[] = [],
): GraphPass {
  const nodes = new Map<string, GraphNode>();
  for (const part of files.values()) for (const node of part.nodes) nodes.set(node.id, node);
  for (const part of files.values()) {
    for (const node of part.targets) if (!nodes.has(node.id)) nodes.set(node.id, node);
  }
  // Entry points, joined across files (ADR 0030); an anonymous handler takes its entry point's full name.
  const entries = joinEntries(
    [...files.values()].flatMap((part) => (part.entries === undefined ? [] : [part.entries])),
    scripts,
    (id) => nodes.has(id),
  );
  for (const [id, name] of entries.handlerNames) {
    const node = nodes.get(id);
    if (node !== undefined) nodes.set(id, { ...node, name });
  }
  for (const node of entries.nodes) nodes.set(node.id, node);
  let builtInCalls = 0;
  for (const part of files.values()) builtInCalls += part.builtInCalls;
  // Links to the app's API and hand-offs to their receivers, joined across files (ADR 0031).
  const joined = joinConnections(
    [...files.values()].flatMap((part) =>
      part.connections === undefined ? [] : [part.connections],
    ),
    entries.nodes,
    [...files.values()].flatMap((part) => part.edges),
    (id) => nodes.get(id),
  );
  for (const node of joined.entries) nodes.set(node.id, node);
  return {
    graph: {
      nodes: [...nodes.values()],
      edges: [...joined.edges, ...entries.edges],
    },
    files: files.size,
    builtInCalls,
    complete,
    note: complete ? null : GRAPH_MESSAGES.partial,
  };
}

/**
 * A pass's entry points, sent ahead of its graph (phase 4 of build plan v2): checking, encoding, storing and loading
 * Twenty's whole graph takes seconds more, and a saved edit is to show in the entry points within 3 s.
 */
export interface ListedEntries {
  readonly lists: EntryPointLists;
  /** Each screen's elements, by the screen's id. */
  readonly screens: ReadonlyMap<string, readonly EntryPointItem[]>;
}

export function listedEntries(graph: Graph): ListedEntries {
  const index = indexGraph(graph);
  const lists = listEntryPoints(index);
  return { lists, screens: elementsByScreen(index, lists.screen, lists.element) };
}
