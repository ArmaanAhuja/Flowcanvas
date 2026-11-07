import { describe, expect, it } from 'vitest';
import { EXAMPLE_BANNER, exampleGraph } from './examples';

describe('the canvas stress test’s example nodes', () => {
  it('are 500 nodes in a grid, each column a chain, all clearly examples', () => {
    const { nodes, edges } = exampleGraph();
    expect(nodes).toHaveLength(500);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(500);
    expect(edges).toHaveLength(500 - 25);
    expect(
      nodes.every((n) => n.id.startsWith('example-') && n.data.location.startsWith('examples/')),
    ).toBe(true);
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(nodes[26]?.position).toEqual({ x: 260, y: 120 });
  });

  it('say on the canvas that they are not the project’s flows', () => {
    expect(EXAMPLE_BANNER).toMatch(/example nodes, not your project’s flows/);
  });
});
