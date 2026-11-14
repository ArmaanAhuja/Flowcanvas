// Entry points on the project's page (phase 8): the left panel lists them as the engine answers, a screen opens to its
// elements, `/` reaches the filter, and Show flow opens the flow from what handles each, or says why it can't.
import type { EntryPointsResult } from '@flowcanvas/engine/protocol';
import type { EntryPointItem } from '@flowcanvas/graph-model';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ELK from 'elkjs/lib/elk.bundled.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import { EMPTY, ProjectPage } from '../project/ProjectPage';
import type { Project } from '../projects/api';
import { INDEX_READY, fakeApi, jsdomLayout } from '../test/fake-api';

// The whole page renders here, as in flow.test.tsx.
vi.setConfig({ testTimeout: 15_000 });
vi.mock('../flow/elk', () => ({ pageElk: () => Promise.resolve(new ELK()) }));

const at = (path: string, line: number, column = 1) => ({ path, line, column });
const item = (
  over: Partial<EntryPointItem> & Pick<EntryPointItem, 'id' | 'kind' | 'name'>,
): EntryPointItem => ({
  framework: 'next',
  place: at('apps/web/src/app/page.tsx', 3),
  complete: true,
  why: null,
  within: null,
  handler: null,
  ...over,
});
const LISTS: Record<string, readonly EntryPointItem[]> = {
  screen: [
    item({
      id: 's1',
      kind: 'screen',
      name: '/polls/:urlId',
      handler: {
        id: 'page.tsx#PollPage',
        name: 'PollPage',
        place: at('apps/web/src/app/polls/page.tsx', 12, 25),
      },
      elements: 1,
    }),
  ],
  'api-route': [
    item({
      id: 'a1',
      kind: 'api-route',
      framework: 'hono',
      name: 'POST /api/private/polls',
      handler: {
        id: 'route.ts#(handler POST /polls)',
        name: 'POST /api/private/polls',
        place: at('apps/web/src/app/api/private/route.ts', 230, 3),
      },
    }),
    item({
      id: 'a2',
      kind: 'api-route',
      framework: 'next',
      name: 'GET /api/integrations/*',
      handler: { id: null, name: 'handler', place: null },
    }),
  ],
  'cli-command': [
    item({ id: 'c1', kind: 'cli-command', framework: 'package-json', name: '@rallly/web: dev' }),
  ],
  element: [
    item({
      id: 'e1',
      kind: 'element',
      framework: 'react',
      name: '<button> onClick',
      handler: {
        id: 'x#(handler)',
        name: '<button> onClick',
        place: at('apps/web/src/app/polls/page.tsx', 30, 24),
      },
    }),
  ],
};
const answer = (
  kind: string,
  entries: readonly EntryPointItem[],
  message: string | null = null,
): EntryPointsResult => ({
  counts: { screen: 1, element: 1, 'api-route': 2, 'cli-command': 1 },
  kind: kind as EntryPointsResult['kind'],
  entries,
  next: null,
  message,
  version: 'a'.repeat(64),
  takenAt: '2026-11-14T10:00:00.000Z',
  current: true,
  complete: true,
});

const project = (state: 'running' | 'sleeping'): Project => ({
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-13T09:00:00.000Z',
  workspace: { id: 'w-1', state, stateChangedAt: '2026-11-13T09:00:00.000Z', failure: null },
});

let asked: string[];
let building: boolean;
const api = (state: 'running' | 'sleeping' = 'running') =>
  fakeApi(project(state), {
    '/workspace/index/status': () => INDEX_READY,
    '/workspace/index/entry-points': (url) => {
      const kind = url.searchParams.get('kind') ?? '';
      const screenId = url.searchParams.get('screen');
      asked.push(screenId === null ? kind : `${kind} of ${screenId}`);
      if (building)
        return answer(
          kind,
          [],
          'Entry points are found with the graph, which is still being built.',
        );
      return answer(kind, LISTS[kind] ?? []);
    },
    '/workspace/index/flow': (url) => {
      asked.push(
        `flow ${url.searchParams.get('path') ?? ''}:${url.searchParams.get('line') ?? ''}`,
      );
      return {
        flow: null,
        message: 'Not in the graph yet.',
        version: null,
        takenAt: null,
        current: true,
        complete: true,
      };
    },
  });

const renderPage = (state: 'running' | 'sleeping' = 'running') =>
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={api(state)} />
    </LabsProvider>,
  );
const row = (name: string) =>
  screen.getByRole('row', { name: new RegExp(`^${name.replace(/[*/]/g, '\\$&')}`) });

beforeEach(() => {
  jsdomLayout();
  asked = [];
  building = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('entry points on the page', () => {
  it('says to start the workspace while it isn’t running', async () => {
    renderPage('sleeping');
    expect(await screen.findByText(EMPTY.left)).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it('says so while the graph is being built', async () => {
    building = true;
    renderPage();
    expect(
      await screen.findByText('Entry points are found with the graph, which is still being built.'),
    ).toBeTruthy();
  });

  it('lists each kind with its count, a screen with its component, and opens a screen to its elements', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('row', { name: /^POST \/api\/private\/polls/ })).toBeTruthy();
    expect(asked.slice(0, 3)).toEqual(['screen', 'api-route', 'cli-command']);
    expect(row('API routes').textContent).toContain('2');
    expect(row('/polls/:urlId').textContent).toContain('PollPage');
    row('/polls/:urlId').focus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('row', { name: /^<button> onClick/ })).toBeTruthy();
    expect(asked).toContain('element of s1');
  });

  it('opens the flow from what handles an entry point, or says why there is none', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /^POST \/api\/private\/polls/ });
    await user.click(
      within(row('POST /api/private/polls')).getByRole('button', {
        name: 'Show the flow from POST /api/private/polls',
      }),
    );
    expect(asked).toContain('flow apps/web/src/app/api/private/route.ts:230');
    row('GET /api/integrations/*').focus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText(
        'GET /api/integrations/* is handled by handler, which isn’t the project’s code: there’s no flow to show.',
      ),
    ).toBeTruthy();
  });

  it('filters by name, and `/` reaches the filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /^POST \/api\/private\/polls/ });
    await user.keyboard('/');
    const filter = screen.getByRole('textbox', { name: 'Filter entry points' });
    expect(document.activeElement).toBe(filter);
    // Typed from the keyboard: in jsdom every box is empty, so a click lands on the panels' resize handle (the
    // walkthrough clicks it in a real browser).
    await user.keyboard('pollpage');
    expect((filter as HTMLInputElement).value).toBe('pollpage');
    expect(row('/polls/:urlId')).toBeTruthy();
    expect(screen.queryByRole('row', { name: /^POST \/api\/private\/polls/ })).toBeNull();
  });
});

describe('⌘K’s entry points', () => {
  it('finds them after /, and Enter opens the flow from the top one', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('row', { name: /^POST \/api\/private\/polls/ });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const search = await screen.findByRole('searchbox', { name: 'Search symbols and files' });
    expect(document.activeElement).toBe(search);
    await user.keyboard('/api/pr');
    expect(
      await screen.findByRole('option', { name: /^Show the flow from POST \/api\/private\/polls/ }),
    ).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(asked).toContain('flow apps/web/src/app/api/private/route.ts:230');
  });
});
