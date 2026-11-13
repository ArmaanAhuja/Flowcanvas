// The Code view on a project's page (phase 3 step 5), with a fake API: the file tree, opening files, editing,
// saving with the version it was opened at, a conflict, and the honest states. jsdom can't type into CodeMirror
// (it listens for real input events), so edits go through CodeMirror's own API; the walkthrough types for real.
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import type { Project } from '../projects/api';
import { ProjectPage } from '../project/ProjectPage';
import { fakeApi, jsdomLayout, reply } from '../test/fake-api';
import { CODE_TEXT, restoredText } from './CodeView';
import { FILES_TEXT } from './texts';

// The whole project page renders here (React Flow, the editor, the dialogs): about 1 s a test alone, past 5 s when
// every package's tests share the laptop's cores in `pnpm test` (found in phase 7, once flows added ELK's tests to
// the run). The work is what's tested, so the limit is set for it.
vi.setConfig({ testTimeout: 15_000 });

const V1 = '1'.repeat(64);
const V2 = '2'.repeat(64);

const project = (state: 'running' | 'sleeping'): Project => ({
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  workspace: { id: 'w-1', state, stateChangedAt: '2026-11-08T09:00:00.000Z', failure: null },
});

const FILES: Record<string, unknown> = {
  'src/index.ts': {
    content: 'export const answer = 42;\n',
    encoding: 'utf8',
    version: V1,
    size: 26,
  },
  'public/logo.png': { content: 'iVBO', encoding: 'base64', version: V1, size: 3 },
  'src/two.ts': { content: 'one\ntwo\nthree\n', encoding: 'utf8', version: V1, size: 14 },
};

let saves: { path: string; body: unknown }[];
/** The workspace's journal: unsaved changes from an earlier visit. */
let journal: Map<string, unknown>;
let saveAnswer: { status: number; body: unknown };

const fakeCodeApi = (state: 'running' | 'sleeping' = 'running') =>
  fakeApi(project(state), {
    '/workspace/tree': () => ({
      files: ['.env.example', 'public/logo.png', 'src/index.ts', 'src/two.ts', 'src/.env'],
      truncated: false,
    }),
    // A saved draft is answered by the catch-all's `{}`, as before; a read finds the journal's entry, if any.
    '/workspace/journal/entry': (url, init) => {
      if (init?.method === 'PUT') return {};
      const entry = journal.get(url.searchParams.get('path') ?? '');
      return entry ?? reply({ error: 'none', code: 'not_found' }, 404);
    },
    '/workspace/file': (url, init) => {
      const path = url.searchParams.get('path') ?? '';
      if (init?.method === 'PUT') {
        saves.push({ path, body: JSON.parse(typeof init.body === 'string' ? init.body : '') });
        return reply(saveAnswer.body, saveAnswer.status);
      }
      if (path === 'src/.env') {
        return reply(
          { error: 'Secrets live in the project’s vault, not in .env files.', code: 'secret_file' },
          403,
        );
      }
      return (
        FILES[path] ?? reply({ error: 'There’s nothing at that path.', code: 'not_found' }, 404)
      );
    },
  });

beforeEach(() => {
  saves = [];
  journal = new Map();
  saveAnswer = { status: 200, body: { path: 'src/index.ts', size: 27, version: V2 } };
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

/** The CodeMirror view inside the editor's shadow root. */
async function editorView(): Promise<EditorView> {
  // The first editor loads CodeMirror (a cold dynamic import): allow for every package's tests running at once.
  const host = await waitFor(
    () => {
      const element = document.querySelector('[data-region="editor"]');
      const editor = element?.shadowRoot?.querySelector('.cm-editor');
      if (!(editor instanceof HTMLElement)) throw new Error('no editor yet');
      return editor;
    },
    { timeout: 10_000 },
  );
  const view = EditorView.findFromDOM(host);
  if (view === null) throw new Error('no view');
  return view;
}

async function openCode() {
  const user = userEvent.setup();
  await screen.findByText('Rallly');
  await user.click(screen.getByRole('tab', { name: 'Code' }));
  return user;
}

/** A tree row by its exact name (the accessible name may add "unsaved changes" after it). */
const row = (name: string) =>
  screen.getByRole('row', {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|,| )`),
  });

describe('the Code view', () => {
  it('lists the files on the left, and asks for one to be chosen', async () => {
    renderPage(fakeCodeApi());
    await openCode();
    expect(await screen.findByRole('heading', { name: 'Files' })).toBeTruthy();
    await screen.findByRole('treegrid', { name: 'Files' });
    expect(await screen.findByText(CODE_TEXT.nothingOpen)).toBeTruthy();
  });

  it('opens a file from the tree, in a tab, with its path and status', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    const view = await editorView();
    expect(view.state.doc.toString()).toBe('export const answer = 42;\n');
    expect(screen.getByRole('button', { name: 'index.ts' }).getAttribute('aria-current')).toBe(
      'true',
    );
    const trail = screen.getByRole('navigation', { name: 'File path' });
    expect(
      within(trail)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['src', 'index.ts']);
    expect(screen.getByRole('group', { name: 'Editor status' }).textContent).toContain(
      'TypeScript',
    );
  });

  it('shows the shown file’s cursor in the status bar after switching files (regression, phase 5)', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    await editorView();
    await user.click(row('two.ts'));
    const status = () => screen.getByRole('group', { name: 'Editor status' }).textContent;
    await waitFor(async () => {
      expect((await editorView()).state.doc.toString()).toBe('one\ntwo\nthree\n');
    });
    const two = await editorView();
    act(() => {
      two.dispatch({ selection: { anchor: 'one\ntwo\nth'.length } });
    });
    expect(status()).toContain('Ln 3, Col 3');
    // Back to index.ts: its own cursor, not two.ts's.
    await user.click(screen.getByRole('button', { name: 'index.ts' }));
    await waitFor(() => {
      expect(status()).toContain('Ln 1, Col 1');
    });
    // And two.ts kept its place.
    await user.click(screen.getByRole('button', { name: 'two.ts' }));
    await waitFor(() => {
      expect(status()).toContain('Ln 3, Col 3');
    });
  });

  it('marks unsaved changes, saves with Ctrl+S from the opened version, and clears the mark', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    const view = await editorView();
    view.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    expect(await screen.findByRole('button', { name: 'index.ts, unsaved changes' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(CODE_TEXT.unsaved);
    fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect(saves).toEqual([
        {
          path: 'src/index.ts',
          body: {
            content: '// edited\nexport const answer = 42;\n',
            encoding: 'utf8',
            baseVersion: V1,
          },
        },
      ]);
    });
    expect(await screen.findByRole('button', { name: 'index.ts' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(CODE_TEXT.saved);
    // The next save is from the version just written.
    view.dispatch({ changes: { from: 0, insert: '// again\n' } });
    fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect((saves[1]?.body as { baseVersion?: string } | undefined)?.baseVersion).toBe(V2);
    });
  });

  it('undoing back to the saved text clears the mark', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    const view = await editorView();
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    await screen.findByRole('button', { name: 'index.ts, unsaved changes' });
    view.dispatch({ changes: { from: 0, to: 1 } });
    expect(await screen.findByRole('button', { name: 'index.ts' })).toBeTruthy();
  });

  it('says so when the file changed in the workspace, and keeps the changes', async () => {
    saveAnswer = {
      status: 409,
      body: { error: 'This file changed in the workspace since you opened it.', code: 'conflict' },
    };
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    const view = await editorView();
    view.dispatch({ changes: { from: 0, insert: 'mine ' } });
    fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(
      'This file changed in the workspace since you opened it. Your changes are still here, not saved.',
    );
    // The two ways out (step 7).
    expect(within(alert).getByRole('button', { name: 'Keep mine' })).toBeTruthy();
    expect(
      within(alert).getByRole('button', { name: 'Load the workspace’s version' }),
    ).toBeTruthy();
    expect(view.state.doc.toString()).toBe('mine export const answer = 42;\n');
    expect(screen.getByRole('button', { name: 'index.ts, unsaved changes' })).toBeTruthy();
  });

  it('shows a binary file and a .env file honestly, never as text', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('public'));
    await user.click(row('logo.png'));
    expect(await screen.findByText(CODE_TEXT.binary)).toBeTruthy();
    await user.click(row('src'));
    await user.click(row('.env'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Secrets live in the project’s vault, not in .env files.',
    );
    expect(document.querySelector('[data-region="editor"]')).toBeNull();
  });

  it('remembers the open files for next time', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    await editorView();
    cleanup();
    renderPage(fakeCodeApi());
    expect(await editorView()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'index.ts' }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('says to open the workspace when it is not running', async () => {
    renderPage(fakeCodeApi('sleeping'));
    await openCode();
    expect(screen.getAllByText(FILES_TEXT.notRunning)).toHaveLength(2);
  });

  it('reopens a file with the unsaved changes from last time, and says so', async () => {
    const at = Date.UTC(2026, 10, 8, 14, 2);
    journal.set('src/index.ts', {
      path: 'src/index.ts',
      content: 'export const answer = 43; // unsaved\n',
      baseVersion: V1,
      revision: 7,
      updatedAt: at,
    });
    localStorage.setItem(
      'flowcanvas-code-p-1',
      JSON.stringify({ open: ['src/index.ts'], active: 'src/index.ts' }),
    );
    localStorage.setItem('flowcanvas-view-p-1', 'code');
    renderPage(fakeCodeApi());
    const view = await editorView();
    expect(view.state.doc.toString()).toBe('export const answer = 43; // unsaved\n');
    expect(await screen.findByText(restoredText(at))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'index.ts, unsaved changes' })).toBeTruthy();
  });

  it('has an autosave switch, on by default and remembered', async () => {
    renderPage(fakeCodeApi());
    const user = await openCode();
    await screen.findByRole('treegrid', { name: 'Files' });
    await user.click(row('src'));
    await user.click(row('index.ts'));
    await editorView();
    const toggle = screen.getByRole('switch', { name: 'Autosave' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem('flowcanvas-autosave')).toBe('off');
  });

  it('does not save restored changes just by arriving in the Code view (regression)', async () => {
    journal.set('src/index.ts', {
      path: 'src/index.ts',
      content: 'restored, not saved\n',
      baseVersion: V1,
      revision: 9,
      updatedAt: Date.UTC(2026, 10, 8, 14, 2),
    });
    localStorage.setItem(
      'flowcanvas-code-p-1',
      JSON.stringify({ open: ['src/index.ts'], active: 'src/index.ts' }),
    );
    renderPage(fakeCodeApi());
    await openCode();
    await editorView();
    expect(await screen.findByRole('button', { name: 'index.ts, unsaved changes' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(saves).toEqual([]);
  });
});
