import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphStats, type GraphStatsSnapshot } from './GraphStats';

afterEach(cleanup);

const snapshot: GraphStatsSnapshot = {
  takenAt: '2026-11-12T10:42:00.000Z',
  complete: true,
  note: null,
  files: 1168,
  builtInCalls: 3930,
  stats: {
    nodes: 3327,
    edges: 16394,
    byNodeKind: {
      'entry-point': 0,
      'code-unit': 3327,
      decision: 0,
      'data-access': 0,
      'async-handoff': 0,
      'external-boundary': 0,
    },
    byCodeUnit: { function: 1603, method: 189, component: 1081, class: 38, module: 416 },
    byEdgeKind: { call: 16394, branch: 0, data: 0, handoff: 0, boundary: 0 },
    byProvenance: { observed: 0, resolved: 7514, convention: 0, suggested: 0, unknown: 8880 },
  },
  buildMs: 4100,
  saveMs: 20,
  loadMs: 1200,
};
const arrivesIn = { 'entry-point': 8, decision: 7, 'data-access': 10, branch: 7 };

/** A group's rows as "name: value". */
const rows = (name: string) =>
  within(screen.getByRole('region', { name }))
    .getAllByRole('term')
    .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ''}`);

describe('GraphStats', () => {
  it('lists every kind, zeros included, saying when the missing ones arrive', () => {
    render(<GraphStats state="ready" snapshot={snapshot} arrivesIn={arrivesIn} />);
    expect(screen.getByText('3,327 nodes · 16,394 edges')).toBeTruthy();
    expect(rows('Nodes')).toEqual([
      'Entry points arrives in phase 8: 0',
      'Code units: 3,327',
      'Decisions arrives in phase 7: 0',
      'Data access arrives in phase 10: 0',
      // No phase given: just its zero.
      'Async hand-offs: 0',
      'External boundaries: 0',
    ]);
    expect(rows('Code units')).toContain('Top levels of files: 416');
    expect(rows('Edges')).toContain('Branches arrives in phase 7: 0');
  });

  it('says how edges are known, by form and in words', () => {
    render(<GraphStats state="ready" snapshot={snapshot} arrivesIn={arrivesIn} />);
    expect(rows('How edges are known')).toEqual([
      'Observed seen running: 0',
      'Resolved proven by the compiler: 7,514',
      'Convention matched by a framework rule: 0',
      'Suggested proposed, unverified: 0',
      'Unknown target not found: 8,880',
    ]);
    const group = screen.getByRole('region', { name: 'How edges are known' });
    // One glyph per provenance; unknown's ends in a hollow circle.
    expect(group.querySelectorAll('svg')).toHaveLength(5);
    expect(group.querySelectorAll('circle')).toHaveLength(1);
  });

  it('counts built-ins apart, and says how long building, saving and loading took', () => {
    render(<GraphStats state="ready" snapshot={snapshot} arrivesIn={arrivesIn} />);
    expect(
      screen.getByText('3,930 calls into TypeScript’s library, counted, not in the graph.'),
    ).toBeTruthy();
    expect(screen.getByText('Built in 4.1 s · saved in 20 ms · loaded in 1.2 s')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says where it stands: waiting, building (with the last version), failed, or no workspace', () => {
    const { rerender } = render(<GraphStats state="waiting" snapshot={null} arrivesIn={{}} />);
    expect(screen.getByRole('status').textContent).toBe(
      'The graph is built once the project is indexed.',
    );
    rerender(<GraphStats state="building" snapshot={snapshot} arrivesIn={{}} />);
    expect(screen.getByRole('status').textContent).toBe('Building the graph…');
    expect(screen.getByText(/^Last version, from 1,168 files/)).toBeTruthy();
    rerender(
      <GraphStats state="failed" message="Too large here." snapshot={snapshot} arrivesIn={{}} />,
    );
    expect(screen.getByRole('status').textContent).toBe('Too large here.');
    rerender(<GraphStats state="unavailable" snapshot={null} arrivesIn={{}} />);
    expect(screen.getByRole('status').textContent).toBe('Open the workspace to see its graph.');
  });

  it('says when the graph covers part of the project', () => {
    render(
      <GraphStats
        state="ready"
        snapshot={{ ...snapshot, complete: false, note: 'Too large to analyse whole.' }}
        arrivesIn={{}}
      />,
    );
    expect(screen.getByText('Too large to analyse whole.')).toBeTruthy();
  });
});
