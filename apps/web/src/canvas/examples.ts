import type { FlowNodeChange, FlowNodeKind } from '@flowcanvas/ui';
import type { CanvasEdge, UnitCanvasNode } from './FlowCanvas';

/**
 * Example nodes for the canvas stress test (Labs) and the performance test: never a project's real flows, and
 * the canvas says so whenever they're shown (rule 10: mock data only in tests, the catalogue, or Labs).
 */
const KINDS: FlowNodeKind[] = [
  'ui',
  'function',
  'route',
  'data',
  'external',
  'queue',
  'ai',
  'auth',
];
const CHANGES: (FlowNodeChange | undefined)[] = [
  undefined,
  undefined,
  undefined,
  'added',
  'modified',
  'affected',
];

export const EXAMPLE_BANNER =
  'Canvas stress test (Labs): 500 example nodes, not your project’s flows.';

export function exampleGraph(
  count = 500,
  columns = 25,
): { nodes: UnitCanvasNode[]; edges: CanvasEdge[] } {
  const nodes: UnitCanvasNode[] = Array.from({ length: count }, (_, i) => {
    const change = CHANGES[i % CHANGES.length];
    return {
      id: `example-${String(i)}`,
      type: 'flow',
      position: { x: (i % columns) * 260, y: Math.floor(i / columns) * 120 },
      data: {
        title: `example${String(i)}`,
        location: `examples/file${String(i % 40)}.ts:${String(10 + (i % 90))}`,
        kind: KINDS[i % KINDS.length] ?? 'function',
        ...(change === undefined ? {} : { change }),
      },
    };
  });
  // Each node calls the one below it, so every column is a chain.
  const edges: CanvasEdge[] = nodes
    .filter((_, i) => i + columns < count)
    .map((node, i) => ({
      id: `example-edge-${String(i)}`,
      source: node.id,
      target: `example-${String(i + columns)}`,
    }));
  return { nodes, edges };
}
