// Flows on the project's page (phase 7): opened from ⌘K, said honestly (its counts, the last version, no flow), and
// what's selected in one read in the inspector. ELK runs in this thread here (the page runs it in a worker).
import type { FlowResult, SymbolHit } from '@flowcanvas/engine/protocol';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ELK from 'elkjs/lib/elk.bundled.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../canvas/FlowCanvas';
import { LabsProvider } from '../labs/LabsProvider';
import { ProjectPage } from '../project/ProjectPage';
import type { Project } from '../projects/api';
import { FlowInspector } from './FlowInspector';

// The whole project page renders here (React Flow, the editor, the dialogs): about 1 s a test alone, past 5 s when
// every package's tests share the laptop's cores in `pnpm test` (found in phase 7, once flows added ELK's tests to
// the run). The work is what's tested, so the limit is set for it.
vi.setConfig({ testTimeout: 15_000 });

vi.mock('./elk', () => ({ pageElk: () => Promise.resolve(new ELK()) }));

const SEND: SymbolHit = {
  path: 'src/send.ts',
  name: 'send',
  kind: 'function',
  container: null,
  line: 3,
  column: 17,
  exported: true,
};
const place = (line: number) => ({ path: 'src/send.ts', line, column: 17 });
const unit = (name: string, line: number) => ({
  id: `src/send.ts#${name}`,
  kind: 'code-unit' as const,
  name,
  place: place(line),
  unit: 'function' as const,
  change: 'unchanged' as const,
});
const FLOW: NonNullable<FlowResult['flow']> = {
  root: 'src/send.ts#send',
  nodes: [
    unit('send', 3),
    {
      id: 'src/send.ts#send?1',
      kind: 'decision',
      name: 'draft',
      place: { path: 'src/send.ts', line: 4, column: 7 },
      unit: null,
      change: 'unchanged',
    },
    unit('save', 20),
  ],
  edges: [
    {
      from: 'src/send.ts#send',
      to: 'src/send.ts#send?1',
      kind: 'branch',
      relation: null,
      label: null,
      provenance: 'resolved',
      lines: [4],
      sites: 1,
    },
    {
      from: 'src/send.ts#send?1',
      to: 'src/send.ts#save',
      kind: 'branch',
      relation: 'calls',
      label: 'yes',
      provenance: 'resolved',
      lines: [5],
      sites: 1,
    },
  ],
  unknown: [
    {
      from: 'src/send.ts#send',
      total: 3,
      calls: [
        { target: 'prisma.poll.create', relation: 'calls', label: null, lines: [8], sites: 1 },
        { target: 'logger.info', relation: 'calls', label: null, lines: [9], sites: 1 },
      ],
    },
  ],
  cut: [{ from: 'src/send.ts#save', nodes: 4 }],
  hidden: 4,
  byProvenance: { observed: 0, resolved: 1, convention: 0, suggested: 0, unknown: 3 },
};
const ANSWER: FlowResult = {
  flow: FLOW,
  message: null,
  version: 'a'.repeat(64),
  takenAt: '2026-11-13T10:00:00.000Z',
  current: true,
  complete: true,
};

const project: Project = {
  id: 'p-1',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-13T09:00:00.000Z',
  workspace: {
    id: 'w-1',
    state: 'running',
    stateChangedAt: '2026-11-13T09:00:00.000Z',
    failure: null,
  },
};

let flowAnswer: FlowResult;
let flowsAsked: string[];

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
    if (url.pathname.endsWith('/workspace/index/search')) return json({ symbols: [SEND], ms: 1 });
    if (url.pathname.endsWith('/workspace/index/flow')) {
      flowsAsked.push(
        `${url.searchParams.get('path') ?? ''}:${url.searchParams.get('line') ?? ''}`,
      );
      return json(flowAnswer);
    }
    return json({});
  };
}

beforeEach(() => {
  flowAnswer = ANSWER;
  flowsAsked = [];
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(248);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const showFlowFromPalette = async () => {
  const user = userEvent.setup();
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={fakeApi()} />
    </LabsProvider>,
  );
  await screen.findByText('Rallly');
  await user.keyboard('{Control>}k{/Control}');
  await user.keyboard('send');
  await user.click(
    await screen.findByRole('option', { name: 'Show the flow from send, src/send.ts:3' }),
  );
};

describe('a flow on the page', () => {
  it('opens from ⌘K, and says what it is and how its edges are known', async () => {
    await showFlowFromPalette();
    expect(flowsAsked).toEqual(['src/send.ts:3']);
    const status = await screen.findByText('4 edges · 1 resolved · 3 unknown');
    expect(
      within(status.closest('[role="status"]') ?? document.body).getByText('send'),
    ).toBeTruthy();
  });

  it('says when it’s from the last version, and why there’s no flow', async () => {
    flowAnswer = { ...ANSWER, current: false };
    await showFlowFromPalette();
    expect(
      await screen.findByText('From the last version: the graph is catching up with your changes.'),
    ).toBeTruthy();
    cleanup();
    flowAnswer = {
      ...ANSWER,
      flow: null,
      message: 'The graph is still being built. Flows open once it’s ready.',
    };
    await showFlowFromPalette();
    expect(
      await screen.findByText('The graph is still being built. Flows open once it’s ready.'),
    ).toBeTruthy();
  });
});

describe('FlowInspector', () => {
  const node = (type: CanvasNode['type'], data: Record<string, unknown>) =>
    ({ id: String(data.id ?? data.from), type, position: { x: 0, y: 0 }, data }) as CanvasNode;
  const show = (selected: CanvasNode) => {
    const onOpen = vi.fn();
    render(
      <FlowInspector
        flow={FLOW}
        selected={selected}
        details={{ kind: 'loading' }}
        onOpen={onOpen}
      />,
    );
    return onOpen;
  };

  it('shows a decision’s whole condition and where each outcome leads, and opens its line', async () => {
    const onOpen = show(
      node('decision', { id: 'src/send.ts#send?1', condition: 'draft', place: place(4) }),
    );
    expect(within(screen.getByRole('list', { name: 'Outcomes' })).getByText('save')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open code' }));
    expect(onOpen).toHaveBeenCalledWith(place(4));
  });

  it('lists a node’s unknown calls, each opening its line, and says how many more', async () => {
    const onOpen = show(node('stub', { from: 'src/send.ts#send', variant: 'unknown', count: 3 }));
    expect(screen.getByText('prisma.poll.create')).toBeTruthy();
    expect(screen.getByText('and 1 more, in the code')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: '8' }));
    expect(onOpen).toHaveBeenCalledWith({ path: 'src/send.ts', line: 8, column: 1 });
  });

  it('says what wasn’t shown, and when expanding arrives', () => {
    show(node('stub', { from: 'src/send.ts#save', variant: 'more', count: 4 }));
    expect(screen.getByText('4 more calls not shown')).toBeTruthy();
    expect(screen.getByText(/Expanding a flow arrives in phase 12/)).toBeTruthy();
  });

  it('reads a function’s details while they load', () => {
    show(
      node('flow', {
        id: 'src/send.ts#save',
        title: 'save',
        location: 'src/send.ts:20',
        place: place(20),
      }),
    );
    expect(screen.getByRole('status').textContent).toBe('Reading the code…');
  });
});
