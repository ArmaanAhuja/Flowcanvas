// The flow graph from its files' parts (ADR 0027): one graph, each node once, a file's own nodes over the targets
// recorded where they're called.
import type { Graph, GraphNode } from '@flowcanvas/graph-model';
import type { FileGraph } from './graph-pass.js';

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

export function assemble(files: ReadonlyMap<string, FileGraph>, complete: boolean): GraphPass {
  const nodes = new Map<string, GraphNode>();
  for (const part of files.values()) for (const node of part.nodes) nodes.set(node.id, node);
  for (const part of files.values()) {
    for (const node of part.targets) if (!nodes.has(node.id)) nodes.set(node.id, node);
  }
  let builtInCalls = 0;
  for (const part of files.values()) builtInCalls += part.builtInCalls;
  return {
    graph: { nodes: [...nodes.values()], edges: [...files.values()].flatMap((part) => part.edges) },
    files: files.size,
    builtInCalls,
    complete,
    note: complete ? null : GRAPH_MESSAGES.partial,
  };
}
