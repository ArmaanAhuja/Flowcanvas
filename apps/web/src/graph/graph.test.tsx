// Labs → Graph stats on a project's page (phase 6's Try it), with a fake API: asked for only while the switch is on,
// often while the graph builds, and shown in the inspector's Details tab.
import type { GraphStatus } from '@flowcanvas/engine/protocol';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import { LABS_STORAGE_KEY } from '../labs/storage';
import { ProjectPage } from '../project/ProjectPage';
import type { Project } from '../projects/api';
import { GRAPH_POLL } from './useGraphStats';

const project = (state: 'running' | 'sleeping'): Project => ({
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  workspace: { id: 'w-1', state, stateChangedAt: '2026-11-12T09:00:00.000Z', failure: null },
});

const READY: GraphStatus = {
  state: 'ready',
  message: null,
  snapshot: {
    version: 'a'.repeat(64),
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
    loadMs: 10,
  },
};

let answers: GraphStatus[];
let asked: number;

function fakeApi(state: 'running' | 'sleeping' = 'running'): typeof fetch {
  return (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'https://flowcanvas.example',
    );
    const json = (body: unknown, code = 200) =>
      Promise.resolve(Response.json(body, { status: code }));
    if (url.pathname === '/api/projects')
      return json({ projects: [project(state)], workspacesAvailable: true });
    if (url.pathname.endsWith('/workspace/index/graph')) {
      asked += 1;
      return json(answers.length > 1 ? answers.shift() : answers[0]);
    }
    if (url.pathname.endsWith('/workspace/index/status')) {
      return json({
        state: 'ready',
        done: 1,
        total: 1,
        files: 1,
        byStatus: { parsed: 1, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
        symbols: 1,
        withSyntaxErrors: 0,
        partlyRead: 0,
        lastFullMs: 10,
        message: null,
      });
    }
    return json({});
  };
}

const renderPage = (fetcher: typeof fetch) =>
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={fetcher} />
    </LabsProvider>,
  );
const labs = (on: boolean) => {
  localStorage.setItem(LABS_STORAGE_KEY, JSON.stringify({ 'graph-stats': on }));
};
const details = () => screen.getByRole('region', { name: 'Graph stats' });

beforeEach(() => {
  answers = [READY];
  asked = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('Labs → Graph stats', () => {
  it('isn’t asked for while its switch is off: the Details tab keeps its empty state', async () => {
    labs(false);
    renderPage(fakeApi());
    await screen.findByText('Rallly');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toBe(0);
    expect(screen.queryByRole('region', { name: 'Graph stats' })).toBeNull();
    expect(
      screen.getByText('Select something on the canvas to see its details here.'),
    ).toBeTruthy();
  });

  it('shows the graph in the Details tab: building first, then its counts', async () => {
    labs(true);
    answers = [{ state: 'building', message: null, snapshot: null }, READY];
    renderPage(fakeApi());
    await waitFor(() => {
      expect(within(details()).getByRole('status').textContent).toBe('Building the graph…');
    });
    // Asked again while it builds, without anyone doing anything.
    expect(
      await within(details()).findByText(
        '3,327 nodes · 16,394 edges',
        {},
        { timeout: GRAPH_POLL.buildingMs + 2000 },
      ),
    ).toBeTruthy();
    expect(asked).toBe(2);
    expect(
      within(details()).getByText('Built in 4.1 s · saved in 20 ms · loaded in 10 ms'),
    ).toBeTruthy();
    expect(within(details()).getByText(/Entry points/).textContent).toBe(
      'Entry points arrives in phase 8',
    );
  });

  it('says to open the workspace when it isn’t running, and asks nothing', async () => {
    labs(true);
    renderPage(fakeApi('sleeping'));
    await screen.findByText('Rallly');
    expect(within(details()).getByRole('status').textContent).toBe(
      'Open the workspace to see its graph.',
    );
    expect(asked).toBe(0);
  });
});
