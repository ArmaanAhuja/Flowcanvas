// @vitest-environment node
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { capFlow, small } from './fixtures';
import { nodeHeight } from '@flowcanvas/ui';
import { SIZES, layoutFlow, shortPlace } from './layout';

const boxes = (laid: Awaited<ReturnType<typeof layoutFlow>>) =>
  laid.nodes.map((node) => ({ id: node.id, ...node.position, ...node.size }));

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

  it('writes where a function is as Figma does, and makes room for a name that wraps', async () => {
    expect(shortPlace('packages/lib/server-only/team/get-team.ts', 38)).toBe('team/get-team.ts:38');
    expect(shortPlace('main.ts', 3)).toBe('main.ts:3');
    // Documenso's deleteFolder reaches canAccessTeamDocument and extractDerivedTeamSettings: two lines each.
    const flow = {
      ...small,
      nodes: small.nodes.map((node) =>
        node.kind === 'decision' ? node : { ...node, name: `${node.name}CanAccessTeamDocument` },
      ),
    };
    const laid = await layoutFlow(flow, new ELK());
    const placed = boxes(laid);
    expect(placed.some((box) => box.height > SIZES.node.height)).toBe(true);
    // Each function as tall as the node renders it (the ui package's own rule).
    for (const node of laid.nodes) {
      if (node.type === 'flow')
        expect(node.size.height, node.id).toBe(nodeHeight(node.data.title, node.data.location));
    }
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

  it('routes every edge from its source’s box to its target’s, for the canvas to draw as ELK placed it', async () => {
    const laid = await layoutFlow(small, new ELK());
    const box = new Map(boxes(laid).map((b) => [b.id, b]));
    const touches = (p: { x: number; y: number }, id: string) => {
      const b = box.get(id);
      return (
        b !== undefined &&
        p.x >= b.x - 1 &&
        p.x <= b.x + b.width + 1 &&
        p.y >= b.y - 1 &&
        p.y <= b.y + b.height + 1
      );
    };
    for (const edge of laid.edges) {
      const route = edge.data.route ?? [];
      expect(route.length, edge.id).toBeGreaterThanOrEqual(2);
      expect(
        touches(route[0] ?? { x: -9, y: -9 }, edge.source),
        `${edge.id} starts at ${edge.source}`,
      ).toBe(true);
      expect(
        touches(route.at(-1) ?? { x: -9, y: -9 }, edge.target),
        `${edge.id} ends at ${edge.target}`,
      ).toBe(true);
    }
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
