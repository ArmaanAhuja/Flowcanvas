// ⌘K on a project's page (phase 4 step 5), with a fake API: the index's progress, opening the palette by key and
// from the top bar, a symbol opened in the Code view at its line, and the honest states.
import { EditorView } from '@codemirror/view';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import type { Project } from '../projects/api';
import { ProjectPage } from '../project/ProjectPage';
import { fakeApi, jsdomLayout, reply } from '../test/fake-api';
import type { IndexStatus, SymbolResult } from './api';
import { INDEX_TEXT } from './texts';

// The whole project page renders here (React Flow, the editor, the dialogs): about 1 s a test alone, past 5 s when
// every package's tests share the laptop's cores in `pnpm test` (found in phase 7, once flows added ELK's tests to
// the run). The work is what's tested, so the limit is set for it.
vi.setConfig({ testTimeout: 15_000 });

const V1 = '1'.repeat(64);
const POLL_TS = '// polls\n\nexport function createPoll() {}\n';
const CREATE_POLL: SymbolResult = {
  path: 'src/poll.ts',
  name: 'createPoll',
  kind: 'function',
  container: null,
  line: 3,
  column: 17,
  exported: true,
};

const project = (state: 'running' | 'sleeping'): Project => ({
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-11T09:00:00.000Z',
  workspace: { id: 'w-1', state, stateChangedAt: '2026-11-11T09:00:00.000Z', failure: null },
});

const status = (state: IndexStatus['state'], done: number, total: number): IndexStatus => ({
  state,
  done,
  total,
  files: done,
  byStatus: { parsed: done, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: done * 3,
  withSyntaxErrors: 0,
  partlyRead: 0,
  lastFullMs: state === 'ready' ? 1800 : null,
  message: null,
});

let statuses: IndexStatus[];
let statusRequests: number;
let searches: string[];
let searchAnswer: { status: number; body: unknown };

const fakePaletteApi = (state: 'running' | 'sleeping' = 'running') =>
  fakeApi(project(state), {
    '/workspace/index/status': () => {
      statusRequests += 1;
      // The last one repeats: the index stays where it got to.
      return statuses.length > 1 ? statuses.shift() : statuses[0];
    },
    '/workspace/index/search': (url) => {
      searches.push(url.searchParams.get('q') ?? '');
      return reply(searchAnswer.body, searchAnswer.status);
    },
    '/workspace/tree': () => ({ files: ['src/poll.ts', 'README.md'], truncated: false }),
    '/workspace/file': (url) =>
      url.searchParams.get('path') === 'src/poll.ts'
        ? { content: POLL_TS, encoding: 'utf8', version: V1, size: POLL_TS.length }
        : reply({ error: 'There’s nothing at that path.', code: 'not_found' }, 404),
    '/workspace/journal/entry': () => reply({ error: 'none', code: 'not_found' }, 404),
  });

beforeEach(() => {
  statuses = [status('ready', 2, 2)];
  statusRequests = 0;
  searches = [];
  searchAnswer = { status: 200, body: { symbols: [CREATE_POLL], ms: 2 } };
  jsdomLayout();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const renderPage = (fetcher: typeof fetch) =>
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={fetcher} />
    </LabsProvider>,
  );

const palette = () => screen.findByRole('dialog', { name: 'Command palette' });

describe('the index’s progress', () => {
  it('shows a chip while indexing, asks again until ready, then says nothing and stops asking', async () => {
    // Indexing until the test says it's ready: the steps don't depend on how fast this machine is (CI's busy
    // runner once took longer than one answer to show the chip, phase 5 milestone A).
    statuses = [status('indexing', 1240, 2031)];
    renderPage(fakePaletteApi());
    const chips = await screen.findAllByText('Indexing 61%', {}, { timeout: 10_000 });
    // Under the Entry points title and over the canvas (design brief, "Still indexing").
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('title')).toBe('Indexing 1,240 of 2,031 files…');
    // It keeps asking while indexing…
    await waitFor(
      () => {
        expect(statusRequests).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000 },
    );
    statuses = [status('ready', 2031, 2031)];
    await waitFor(
      () => {
        expect(screen.queryByText(/^Indexing/)).toBeNull();
      },
      { timeout: 5000 },
    );
    const asked = statusRequests;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(statusRequests).toBe(asked);
  });

  it('says when indexing stopped, in the engine’s words', async () => {
    statuses = [
      {
        ...status('failed', 10, 20),
        message: 'Indexing stopped. Reopen the project to try again.',
      },
    ];
    renderPage(fakePaletteApi());
    const chips = await screen.findAllByText(INDEX_TEXT.stopped);
    expect(chips[0]?.getAttribute('title')).toBe(
      'Indexing stopped. Reopen the project to try again.',
    );
  });

  it('asks nothing while the workspace isn’t running', async () => {
    renderPage(fakePaletteApi('sleeping'));
    await screen.findByText('Rallly');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statusRequests).toBe(0);
  });
});

describe('⌘K', () => {
  it('opens from the keyboard and from the top bar’s search', async () => {
    const user = userEvent.setup();
    renderPage(fakePaletteApi());
    await screen.findByText('Rallly');
    await user.keyboard('{Control>}k{/Control}');
    expect(await palette()).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    });
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+K$/);
    await user.click(search);
    expect(await palette()).toBeTruthy();
  });

  // The Try it itself: typing in the palette and opening CodeMirror, about 1 s on the laptop; past 5 s once on CI's
  // busy runner (phase 6). The steps are what's tested, so the limit is set for them.
  it('opens a symbol in the Code view at its line (the Try it)', async () => {
    const user = userEvent.setup();
    renderPage(fakePaletteApi());
    await screen.findByText('Rallly');
    await user.keyboard('{Control>}k{/Control}');
    await palette();
    await user.keyboard('createpoll');
    await screen.findByRole('option', { name: 'createPoll, function, src/poll.ts:3' });
    await user.keyboard('{Enter}');

    // The Code view, the file, and the cursor on the name.
    expect(await screen.findByRole('tab', { name: 'Code', selected: true })).toBeTruthy();
    const host = await waitFor(
      () => {
        const editor = document
          .querySelector('[data-region="editor"]')
          ?.shadowRoot?.querySelector('.cm-editor');
        if (!(editor instanceof HTMLElement)) throw new Error('no editor yet');
        return editor;
      },
      { timeout: 10_000 },
    );
    const view = EditorView.findFromDOM(host);
    await waitFor(() => {
      expect(view?.state.doc.toString()).toBe(POLL_TS);
    });
    await waitFor(() => {
      const head = view?.state.selection.main.head ?? -1;
      expect(head).toBe(POLL_TS.indexOf('createPoll'));
    });
    expect(
      within(screen.getByRole('group', { name: 'Editor status' })).getByText('Ln 3, Col 17'),
    ).toBeTruthy();
    expect(searches.at(-1)).toBe('createpoll');
  }, 15_000);

  it('says why symbols aren’t there when the search fails', async () => {
    searchAnswer = {
      status: 502,
      body: { error: 'The project index stopped. Reopen the project to start it again.' },
    };
    const user = userEvent.setup();
    renderPage(fakePaletteApi());
    await screen.findByText('Rallly');
    await user.keyboard('{Control>}k{/Control}');
    await palette();
    await user.keyboard('poll');
    expect((await screen.findByRole('status')).textContent).toBe(
      'Symbols aren’t available: The project index stopped. Reopen the project to start it again.',
    );
  });

  it('says to open the workspace when it isn’t running', async () => {
    const user = userEvent.setup();
    renderPage(fakePaletteApi('sleeping'));
    await screen.findByText('Rallly');
    await user.keyboard('{Control>}k{/Control}');
    await palette();
    await user.keyboard('poll');
    expect((await screen.findByRole('status')).textContent).toBe(INDEX_TEXT.notRunning);
    expect(searches).toEqual([]);
  });
});
