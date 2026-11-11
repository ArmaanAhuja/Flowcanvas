// TypeScript's answers on a project's page (phase 5 step 5), with a fake API: right-click → Callers fills the
// inspector's Calls tab (the Try it), F12 goes to the definition, Shift+F12 lists references, a row opens its place,
// and an answer for a question since replaced is dropped.
import { EditorView } from '@codemirror/view';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import type { Project } from '../projects/api';
import { ProjectPage } from '../project/ProjectPage';
import type { CallsAnswer, DefinitionAnswer, ReferencesAnswer } from './api';
import { useCalls } from './useCalls';

const V1 = '1'.repeat(64);
const POLL_TS = 'import { save } from "./db";\n\nexport function createPoll() {\n  save();\n}\n';

const project: Project = {
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  workspace: {
    id: 'w-1',
    state: 'running',
    stateChangedAt: '2026-11-12T09:00:00.000Z',
    failure: null,
  },
};

const CREATE_POLL = {
  name: 'createPoll',
  kind: 'function' as const,
  container: null,
  place: { path: 'src/poll.ts', line: 3, column: 17 },
  builtIn: false,
};

const CALLERS: CallsAnswer = {
  target: CREATE_POLL,
  entries: [
    {
      name: 'route.ts (top level)',
      kind: null,
      container: null,
      place: null,
      builtIn: false,
      relation: 'calls',
      provenance: 'resolved',
      sites: [{ path: 'src/poll.ts', line: 4, column: 3 }],
    },
  ],
  complete: true,
  message: null,
};

let asked: { op: string; path: string | null; line: string | null; column: string | null }[];
let definition: DefinitionAnswer;
let references: ReferencesAnswer;

function fakeApi(): typeof fetch {
  return (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'https://flowcanvas.example',
    );
    const json = (body: unknown, code = 200) =>
      Promise.resolve(Response.json(body, { status: code }));
    if (url.pathname === '/api/projects')
      return json({ projects: [project], workspacesAvailable: true });
    const op = /\/workspace\/index\/(definition|references|callers|callees)$/.exec(
      url.pathname,
    )?.[1];
    if (op !== undefined) {
      asked.push({
        op,
        path: url.searchParams.get('path'),
        line: url.searchParams.get('line'),
        column: url.searchParams.get('column'),
      });
      if (op === 'definition') return json(definition);
      if (op === 'references') return json(references);
      return json(CALLERS);
    }
    if (url.pathname.endsWith('/workspace/index/status'))
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
    if (url.pathname.endsWith('/workspace/index/search'))
      return json({
        symbols: [
          {
            path: 'src/poll.ts',
            name: 'createPoll',
            kind: 'function',
            container: null,
            line: 3,
            column: 17,
            exported: true,
          },
        ],
        ms: 1,
      });
    if (url.pathname.endsWith('/workspace/tree'))
      return json({ files: ['src/poll.ts'], truncated: false });
    if (url.pathname.endsWith('/workspace/file'))
      return json({ content: POLL_TS, encoding: 'utf8', version: V1, size: POLL_TS.length });
    if (url.pathname.endsWith('/workspace/journal/entry'))
      return json({ error: 'none', code: 'not_found' }, 404);
    return json({});
  };
}

beforeEach(() => {
  asked = [];
  definition = { definitions: [], message: null };
  references = { target: CREATE_POLL, references: [], complete: true, message: null };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(248);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The page with src/poll.ts open in the Code view, the cursor on `createPoll` (through ⌘K, as a person would). */
async function openCreatePoll() {
  const user = userEvent.setup();
  // The Code view with src/poll.ts open, as the page remembers it. (Through ⌘K, typing key by key, this setup
  // outlasted the 5 s test limit on CI's busy runner; ⌘K has its own tests, palette.test.tsx.)
  localStorage.setItem('flowcanvas-view-p-1', 'code');
  localStorage.setItem(
    'flowcanvas-code-p-1',
    JSON.stringify({ open: ['src/poll.ts'], active: 'src/poll.ts' }),
  );
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={fakeApi()} />
    </LabsProvider>,
  );
  const host = await waitFor(
    () => {
      const element = document.querySelector<HTMLElement>('[data-region="editor"]');
      const editor = element?.shadowRoot?.querySelector('.cm-editor');
      if (element === null || !(editor instanceof HTMLElement)) throw new Error('no editor yet');
      return { element, view: EditorView.findFromDOM(editor) };
    },
    { timeout: 10_000 },
  );
  await waitFor(() => {
    expect(host.view?.state.doc.toString()).toBe(POLL_TS);
  });
  // The cursor on createPoll, as a click there would leave it.
  act(() => {
    host.view?.dispatch({ selection: { anchor: POLL_TS.indexOf('createPoll') } });
  });
  return { user, ...host };
}

describe('the Code view’s right-click menu', () => {
  it('asks for the callers and shows them in the inspector’s Calls tab (the Try it)', async () => {
    const { user, element, view } = await openCreatePoll();
    // jsdom has no layout: stand in for the browser, the pointer landing on "Poll" in createPoll (line 3, column
    // 23), away from the cursor. The menu must ask about where the pointer was, and move the cursor there.
    const pointed = POLL_TS.indexOf('Poll()');
    const posAtCoords = vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(pointed);
    fireEvent.contextMenu(element, { clientX: 40, clientY: 60 });
    expect(posAtCoords).toHaveBeenCalledWith({ x: 40, y: 60 });
    expect(view?.state.selection.main.head).toBe(pointed);
    const menu = await screen.findByRole('menu', { name: 'Code' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(
      ['Go to definitionF12', 'Find referencesShift+F12', 'Callers', 'Callees'],
    );
    await user.click(screen.getByRole('menuitem', { name: 'Callers' }));

    // 1-based, as the API takes it.
    expect(asked).toEqual([{ op: 'callers', path: 'src/poll.ts', line: '3', column: '23' }]);
    expect(await screen.findByRole('tab', { name: 'Calls', selected: true })).toBeTruthy();
    const caller = await screen.findByRole('button', {
      name: 'route.ts (top level), calls, resolved, src/poll.ts:4',
    });
    // A caller opens where the call is.
    await user.click(caller);
    await waitFor(() => {
      expect(view?.state.selection.main.head).toBe(POLL_TS.indexOf('save();'));
    });
  });

  it('switches to Callees with the same question', async () => {
    const { user, element } = await openCreatePoll();
    vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(POLL_TS.indexOf('createPoll'));
    fireEvent.contextMenu(element, { clientX: 40, clientY: 60 });
    await user.click(await screen.findByRole('menuitem', { name: 'Callers' }));
    await screen.findByRole('tab', { name: 'Calls', selected: true });
    await user.click(screen.getByRole('tab', { name: 'Callees' }));
    await waitFor(() => {
      expect(asked.map((a) => a.op)).toEqual(['callers', 'callees']);
    });
    expect(asked[1]).toMatchObject({ path: 'src/poll.ts', line: '3', column: '17' });
  });
});

describe('F12 and Shift+F12', () => {
  it('F12 goes to the definition', async () => {
    definition = {
      definitions: [{ ...CREATE_POLL, place: { path: 'src/poll.ts', line: 1, column: 10 } }],
      message: null,
    };
    const { element, view } = await openCreatePoll();
    fireEvent.keyDown(element, { key: 'F12' });
    await waitFor(() => {
      expect(view?.state.selection.main.head).toBe(POLL_TS.indexOf('save'));
    });
    expect(asked).toEqual([{ op: 'definition', path: 'src/poll.ts', line: '3', column: '17' }]);
  });

  it('F12 says so in the Calls tab when there’s no definition', async () => {
    const { element } = await openCreatePoll();
    fireEvent.keyDown(element, { key: 'F12' });
    expect(await screen.findByText('TypeScript found no definition for this.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Calls', selected: true })).toBeTruthy();
  });

  it('Shift+F12 lists the references, the definition marked', async () => {
    references = {
      target: CREATE_POLL,
      references: [
        { path: 'src/poll.ts', line: 3, column: 17, isDefinition: true },
        { path: 'src/route.ts', line: 12, column: 5, isDefinition: false },
      ],
      complete: true,
      message: null,
    };
    const { element } = await openCreatePoll();
    fireEvent.keyDown(element, { key: 'F12', shiftKey: true });
    expect(await screen.findByRole('button', { name: 'src/poll.ts:3, definition' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'src/route.ts:12' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'References', selected: true })).toBeTruthy();
  });

  it('leaves F12 with a modifier to the browser', async () => {
    const { element } = await openCreatePoll();
    fireEvent.keyDown(element, { key: 'F12', ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toEqual([]);
  });
});

describe('useCalls', () => {
  it('drops an answer for a question since replaced', async () => {
    const answers: ((value: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve);
        }),
    );
    const { result } = renderHook(() => useCalls('p-1', fetcher));
    const at = { path: 'src/poll.ts', line: 3, column: 17 };
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.ask('callers', at);
      second = result.current.ask('callees', at);
    });
    expect(result.current.state.status).toBe('loading');
    // The second answers first; the first's late answer must not replace it.
    await act(async () => {
      answers[1]?.(Response.json({ ...CALLERS, entries: [] }));
      await second;
      answers[0]?.(Response.json(CALLERS));
      await first;
    });
    expect(result.current.state.view).toBe('callees');
    expect(result.current.state.rows).toEqual([]);
    expect(result.current.state.asked).toBe(2);
  });
});
