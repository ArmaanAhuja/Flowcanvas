// @vitest-environment node
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { capFlow, small } from './fixtures';
import { SIZES, layoutFlow } from './layout';

const boxes = (laid: Awaited<ReturnType<typeof layoutFlow>>) =>
  laid.nodes.map((node) => ({
    id: node.id,
    ...node.position,
    width: node.type === 'flow' ? SIZES.node.width : 40,
    height: node.type === 'flow' ? SIZES.node.height : 16,
  }));

describe('layoutFlow', () => {
  it('lays a flow out top to bottom, each node below what calls it, stubs below their node', async () => {
    const laid = await layoutFlow(small, new ELK());
    const y = new Map(laid.nodes.map((node) => [node.id, node.position.y]));
    for (const e of laid.edges) {
      expect(y.get(e.target), `${e.source} → ${e.target}`).toBeGreaterThan(
        y.get(e.source) ?? Infinity,
      );
    }
    expect(laid.nodes.map((n) => n.type).sort()).toEqual(
      ['decision', 'decision', 'flow', 'flow', 'flow', 'flow', 'flow', 'stub'].sort(),
    );
    const stub = laid.nodes.find((n) => n.type === 'stub');
    expect(stub?.data).toEqual({ from: 'src/send.ts#send', variant: 'unknown', count: 2 });
    // The catch's outcome is a failure path; a stub's edge has no arrow.
    expect(laid.edges.find((e) => e.data.label === 'error')?.data.failure).toBe(true);
    expect(laid.edges.find((e) => e.target === stub?.id)?.data).toMatchObject({
      stub: true,
      provenance: 'unknown',
    });
    expect(laid.nodes.find((n) => n.id === 'src/send.ts#save')?.data).toMatchObject({
      title: 'save',
      location: 'src/send.ts:30',
      kind: 'function',
    });
  });

  it('lays a flow at the 60-node cap out without overlaps', async () => {
    // A tree of calls, some shared, one node in eight a decision, unknown groups and cuts: the shape the spike timed.
    const big = capFlow();
    const laid = await layoutFlow(big, new ELK());
    expect(laid.nodes).toHaveLength(64);
    const placed = boxes(laid);
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });
});
