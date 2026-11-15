import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 9 · Try it: in Rallly, open the "Create poll" submit; the flow continues into the API handler. In a real
// browser under the production CSP: the left panel lists Rallly's screens and elements, opening /:locale/polls/new
// shows its submit element, and Show flow draws the flow starting at the client-side submit handler and crossing
// via a convention link into the API route handler and server mutation.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000c8',
  '2026-11-15T09:00:00.000Z',
  'Rallly',
);

const SCREEN_ID =
  'apps/web/src/app/[locale]/(space)/(dashboard)/polls/new/page.tsx#(entry /:locale/polls/new)';
const SUBMIT_PATH = 'apps/web/src/app/[locale]/(space)/(dashboard)/polls/new/create-poll-form.tsx';
const API_ROUTE_PATH = 'apps/web/src/app/api/private/[...route]/route.ts';
const MUTATION_PATH = 'apps/web/src/features/poll/mutations.ts';

const SCREEN_ITEM = {
  id: SCREEN_ID,
  name: '/:locale/polls/new',
  kind: 'screen' as const,
  framework: 'next',
  complete: true,
  why: null,
  elements: 1,
  place: { path: 'apps/web/src/app/[locale]/(space)/(dashboard)/polls/new/page.tsx', line: 1 },
  within: null,
  handler: {
    id: 'apps/web/src/app/[locale]/(space)/(dashboard)/polls/new/page.tsx#Page',
    place: { path: 'apps/web/src/app/[locale]/(space)/(dashboard)/polls/new/page.tsx', line: 5 },
  },
};

const SUBMIT_ITEM = {
  id: `${SUBMIT_PATH}#(element 42:15)`,
  name: '<form> onSubmit',
  kind: 'element' as const,
  framework: 'react',
  complete: true,
  why: null,
  place: { path: SUBMIT_PATH, line: 42 },
  within: `${SUBMIT_PATH}#CreatePollForm`,
  handler: {
    id: `${SUBMIT_PATH}#onSubmit`,
    place: { path: SUBMIT_PATH, line: 42 },
  },
};

const FLOW = {
  root: `${SUBMIT_PATH}#onSubmit`,
  nodes: [
    {
      id: `${SUBMIT_PATH}#onSubmit`,
      kind: 'code-unit',
      name: '<form> onSubmit',
      place: { path: SUBMIT_PATH, line: 42, column: 15 },
      unit: 'function',
      change: 'unchanged',
    },
    {
      id: `${API_ROUTE_PATH}#(handler POST /polls)`,
      kind: 'code-unit',
      name: 'POST /api/private/polls',
      place: { path: API_ROUTE_PATH, line: 269, column: 3 },
      unit: 'function',
      change: 'unchanged',
    },
    {
      id: `${MUTATION_PATH}#createPoll`,
      kind: 'code-unit',
      name: 'createPoll',
      place: { path: MUTATION_PATH, line: 25, column: 14 },
      unit: 'function',
      change: 'unchanged',
    },
  ],
  edges: [
    {
      from: `${SUBMIT_PATH}#onSubmit`,
      to: `${API_ROUTE_PATH}#(handler POST /polls)`,
      kind: 'call',
      relation: 'calls',
      label: null,
      provenance: 'convention',
      lines: [50],
      sites: 1,
    },
    {
      from: `${API_ROUTE_PATH}#(handler POST /polls)`,
      to: `${MUTATION_PATH}#createPoll`,
      kind: 'call',
      relation: 'calls',
      label: null,
      provenance: 'resolved',
      lines: [275],
      sites: 1,
    },
  ],
  unknown: [],
  cut: [],
  hidden: 0,
  byProvenance: { observed: 0, resolved: 1, convention: 1, suggested: 0, unknown: 0 },
};

const VERSION = '9'.repeat(64);

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/entry-points': (url) => {
        const kind = url.searchParams.get('kind') ?? '';
        const screen = url.searchParams.get('screen');
        const entries =
          screen === null
            ? kind === 'screen'
              ? [SCREEN_ITEM]
              : []
            : screen === SCREEN_ID
              ? [SUBMIT_ITEM]
              : [];
        return {
          counts: { screen: 1, element: 1, 'api-route': 1, 'cli-command': 0 },
          kind,
          entries,
          next: null,
          message: null,
          version: VERSION,
          takenAt: '2026-11-15T10:00:00.000Z',
          current: true,
          complete: true,
        };
      },
      '/workspace/index/flow': (url) => {
        const path = url.searchParams.get('path');
        const asked = path === SUBMIT_PATH;
        return {
          flow: asked ? FLOW : null,
          message: asked ? null : 'No flow for this element.',
          version: VERSION,
          takenAt: '2026-11-15T10:00:00.000Z',
          current: true,
          complete: true,
        };
      },
      '/workspace/index/details': () => ({
        details: null,
        message: 'Details aren’t in this fake.',
      }),
    },
  });
}

test('phase 9 · Try it: in Rallly, a client form submit links to its API route handler in the flow', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Rallly', { exact: true })).toBeVisible();

  await test.step('Open the screen to its elements and Show flow on the form submit', async () => {
    const left = page.getByRole('region', { name: 'Entry points' });
    const screenRow = left.getByRole('row', { name: '/:locale/polls/new', exact: true });
    await expect(screenRow).toBeVisible();
    await screenRow.focus();
    await page.keyboard.press('ArrowRight');

    const submitRow = left.getByRole('row', { name: /^<form> onSubmit/ });
    await expect(submitRow).toBeVisible();
    await submitRow.hover();
    await submitRow.getByRole('button', { name: 'Show the flow from <form> onSubmit' }).click();
  });

  await test.step('The canvas draws the client submit linking across to the API handler and server mutation', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await expect(canvas.getByText('<form> onSubmit', { exact: true }).first()).toBeVisible();
    await expect(
      canvas.getByText('POST /api/private/polls', { exact: true }).first(),
    ).toBeVisible();
    await expect(canvas.getByText('createPoll', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByRole('status')).toContainText('2 edges');
  });

  expect(watch.problems()).toEqual([]);
});
