import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 8 · Try it: the left panel lists screens, routes, jobs and events (Figma 06); click each to open its flow. In
// a real browser under the production CSP: Rallly's entry points grouped with their counts, a screen opened to its
// elements, the filter clicked and typed into, Show flow drawing the flow from a route's handler, ⌘K finding entry
// points after `/`, and an element whose handler isn't the project's code saying why there's no flow. The workspace
// is a fake answering with the engine's own output for Rallly at its pin (fixtures/phase-8-rallly.json); the engine
// is held to 2,118 hand-labelled entry points, each opening its flow, by the Docker corpus test.

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c8', '2026-11-14T09:00:00.000Z');

interface Item {
  readonly id: string;
  readonly name: string;
  readonly handler: {
    readonly id: string | null;
    readonly place: { readonly path: string; readonly line: number } | null;
  } | null;
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-8-rallly.json', import.meta.url), 'utf8'),
) as {
  lists: Record<string, readonly Item[]>;
  screen: string;
  elements: readonly Item[];
  flow: { readonly root: string };
};
const VERSION = 'b'.repeat(64);
const POST_POLLS = FIXTURE.lists['api-route']?.find((e) => e.name === 'POST /api/private/polls');

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/entry-points': (url) => {
        const kind = url.searchParams.get('kind') ?? '';
        const screen = url.searchParams.get('screen');
        const entries =
          screen === null
            ? (FIXTURE.lists[kind] ?? [])
            : screen === FIXTURE.screen
              ? FIXTURE.elements
              : [];
        return {
          counts: {
            screen: FIXTURE.lists.screen?.length ?? 0,
            element: FIXTURE.elements.length,
            'api-route': FIXTURE.lists['api-route']?.length ?? 0,
            job: FIXTURE.lists.job?.length ?? 0,
            cron: FIXTURE.lists.cron?.length ?? 0,
            event: FIXTURE.lists.event?.length ?? 0,
            'cli-command': FIXTURE.lists['cli-command']?.length ?? 0,
          },
          kind,
          entries,
          next: null,
          message: null,
          version: VERSION,
          takenAt: '2026-11-14T10:00:00.000Z',
          current: true,
          complete: true,
        };
      },
      // The engine's flow from POST /api/private/polls's handler; anywhere else, not in this fake.
      '/workspace/index/flow': (url) => {
        const at = POST_POLLS?.handler?.place;
        const asked =
          at == null
            ? false
            : url.searchParams.get('path') === at.path &&
              Number(url.searchParams.get('line')) === at.line;
        return {
          flow: asked ? FIXTURE.flow : null,
          message: asked
            ? null
            : 'Only POST /api/private/polls’s flow is in this walkthrough’s fake.',
          version: VERSION,
          takenAt: '2026-11-14T10:00:00.000Z',
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

const left = (page: Page) => page.getByRole('region', { name: 'Entry points' });
const row = (page: Page, name: RegExp) => left(page).getByRole('row', { name });

test('phase 8 · Try it: the left panel lists screens, routes, jobs and events; each opens its flow', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Rallly', { exact: true })).toBeVisible();

  await test.step('The left panel: the design brief’s groups with their counts; Rallly has no jobs or events', async () => {
    // Only the rows in view are in the page: each group is closed (arrow left) to reach the next.
    await expect(row(page, /^Screens and elements/)).toContainText('65');
    await row(page, /^Screens and elements/).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(row(page, /^API routes/)).toContainText('152');
    await row(page, /^API routes/).focus();
    await page.keyboard.press('ArrowLeft');
    // Phase 11 lists what takes handed-off work; Rallly's code has none (the engine and the labels agree).
    await expect(row(page, /^Jobs and cron/)).toContainText('0');
    await expect(left(page).getByRole('row', { name: 'None found in this project.' })).toHaveCount(
      2,
    );
    await expect(row(page, /^CLI commands/)).toContainText('92');
    const firstCommand = FIXTURE.lists['cli-command']?.[0]?.name ?? '';
    await expect(
      left(page).getByRole('row', {
        name: new RegExp(`^${firstCommand.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`),
      }),
    ).toBeVisible();
    // Open again for what follows.
    for (const group of [/^API routes/, /^Screens and elements/]) {
      await row(page, group).focus();
      await page.keyboard.press('ArrowRight');
    }
  });

  await test.step('A screen opens to its elements; one handled by code that isn’t the project’s says there’s no flow', async () => {
    // Arrow right opens a row (the WAI-ARIA tree); a click on a row is its action, which opens its flow.
    await left(page).getByRole('row', { name: '/:locale/polls', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(row(page, /^<Popover> onOpenChange/)).toBeVisible();
    await row(page, /^<Popover> onOpenChange/).focus();
    await page.keyboard.press('Enter');
    await expect(left(page)).toContainText(
      // Its handler is `setOpen`, a useState setter: React's code, not the project's.
      '<Popover> onOpenChange is handled by setOpen, which isn’t the project’s code: there’s no flow to show.',
    );
  });

  await test.step('Click the filter, type, and Show flow: the flow from the route’s handler', async () => {
    await page.getByRole('textbox', { name: 'Filter entry points' }).click();
    await page.keyboard.type('private/polls');
    const post = row(page, /^POST \/api\/private\/polls/);
    await expect(post).toBeVisible();
    await expect(left(page).getByRole('row', { name: '/:locale/polls', exact: true })).toHaveCount(
      0,
    );
    await post.hover();
    await post.getByRole('button', { name: 'Show the flow from POST /api/private/polls' }).click();
    const canvas = page.getByRole('main', { name: 'Canvas' });
    // The handler is a unit of its own, named after its route (ADR 0030 §3).
    await expect(
      canvas.getByText('POST /api/private/polls', { exact: true }).first(),
    ).toBeVisible();
    await expect(canvas.getByRole('status')).toContainText('edges');
  });

  await test.step('⌘K after /: entry points only; choosing one opens its flow', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('/api/private/polls');
    const results = page.getByRole('listbox', { name: 'Results' });
    await expect(results.getByRole('group')).toHaveCount(1);
    await results
      .getByRole('option', { name: /^Show the flow from POST \/api\/private\/polls, api route/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(
      page
        .getByRole('main', { name: 'Canvas' })
        .getByText('POST /api/private/polls', { exact: true })
        .first(),
    ).toBeVisible();
  });

  expect(await watch.problems()).toEqual([]);
});
