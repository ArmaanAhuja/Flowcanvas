import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 11 · Try it: in Twenty, an async hand-off leads to workers in the background lane. In a real browser under
// the production CSP: find cleanWorkspace with ⌘K, open its flow, read the queue hand-off and the framed Background
// lane below the main flow containing the background worker, and inspect the hand-off in the right panel.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000c9',
  '2026-11-15T09:00:00.000Z',
  'Twenty',
);

const CLEAN_PATH = 'packages/twenty-server/src/workspace/clean.ts';
const WORKER_PATH = 'packages/twenty-server/src/workspace/clean.job.ts';

const FLOW = {
  root: `${CLEAN_PATH}#cleanWorkspace`,
  nodes: [
    {
      id: `${CLEAN_PATH}#cleanWorkspace`,
      kind: 'code-unit',
      name: 'cleanWorkspace',
      place: { path: CLEAN_PATH, line: 12, column: 14 },
      unit: 'function',
      change: 'unchanged',
    },
    {
      id: '(handoff queue:twenty-queue)',
      kind: 'async-handoff',
      name: 'workspace-clean',
      place: null,
      unit: null,
      change: 'unchanged',
      handoff: {
        kind: 'queue',
        library: 'twenty-queue',
        name: 'workspace-clean',
        complete: true,
        why: null,
      },
    },
    {
      id: `${WORKER_PATH}#cleanWorker`,
      kind: 'code-unit',
      name: 'cleanWorker',
      place: { path: WORKER_PATH, line: 20, column: 14 },
      unit: 'function',
      change: 'unchanged',
    },
  ],
  edges: [
    {
      from: `${CLEAN_PATH}#cleanWorkspace`,
      to: '(handoff queue:twenty-queue)',
      kind: 'handoff',
      relation: null,
      label: null,
      provenance: 'convention',
      lines: [30],
      sites: 1,
    },
    {
      from: '(handoff queue:twenty-queue)',
      to: `${WORKER_PATH}#cleanWorker`,
      kind: 'handoff',
      relation: null,
      label: null,
      provenance: 'convention',
      lines: [20],
      sites: 1,
    },
  ],
  unknown: [],
  cut: [],
  hidden: 0,
  byProvenance: { observed: 0, resolved: 0, convention: 2, suggested: 0, unknown: 0 },
};

const VERSION = '11'.repeat(32);

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'cleanworkspace'.startsWith(query)
            ? [
                {
                  name: 'cleanWorkspace',
                  kind: 'function',
                  container: null,
                  exported: true,
                  path: CLEAN_PATH,
                  line: 12,
                  column: 14,
                },
              ]
            : [],
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const path = url.searchParams.get('path');
        const asked = path === CLEAN_PATH;
        return {
          flow: asked ? FLOW : null,
          message: asked ? null : 'No flow here.',
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

test('phase 11 · Try it: in Twenty, an async hand-off leads to workers in the background lane', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Twenty', { exact: true })).toBeVisible();

  await test.step('Open cleanWorkspace from ⌘K', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('cleanWorkspace');
    await page.getByRole('option', { name: /^Show the flow from cleanWorkspace/ }).click();
  });

  await test.step('The canvas shows the hand-off and the Background lane framing the worker', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await expect(canvas.getByText('cleanWorkspace', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('workspace-clean', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('queue · twenty-queue', { exact: true }).first()).toBeVisible();

    // The Background lane frames the worker below the main flow.
    const lane = canvas.getByRole('group', { name: 'Background lane' });
    await expect(lane).toBeVisible();
    await expect(canvas.getByText('cleanWorker', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByRole('status')).toContainText('2 edges · 2 convention');
  });

  await test.step('Clicking the hand-off node opens its Async hand-off details in the inspector', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await canvas.getByText('workspace-clean', { exact: true }).first().click();

    const inspector = page.getByRole('region', { name: 'workspace-clean' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Async hand-off', { exact: true })).toBeVisible();
    await expect(inspector.getByText('Queue', { exact: true })).toBeVisible();
    await expect(inspector.getByText('twenty-queue', { exact: true })).toBeVisible();
    await expect(inspector.getByText('cleanWorker', { exact: true })).toBeVisible();
    await expect(inspector).toContainText('Known by a library’s rule (convention)');
  });

  expect(watch.problems()).toEqual([]);
});
