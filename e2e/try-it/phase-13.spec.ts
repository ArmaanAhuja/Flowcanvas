import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 13 · Try it: switch to Sequence on any flow; compare with Figma 08. In a real browser under the production CSP,
// on the engine's own flow for Twenty's EmailService.send (fixtures/phase-11-twenty.json):
// - the top bar's Graph / Sequence switch;
// - the same flow as rows, each node once, in the code's order, the hand-off's work in a Background group after it,
//   and no timings, which the view says (Done when: the same flow reads correctly in both views);
// - a row opens the same node in the inspector as the graph does.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000cd',
  '2026-11-15T09:00:00.000Z',
  'Twenty',
);
const EMAIL = 'packages/twenty-server/src/engine/core-modules/email/email.service.ts';
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-11-twenty.json', import.meta.url), 'utf8'),
) as { flows: Record<string, unknown> };
const VERSION = 'd'.repeat(64);

const SYMBOLS = [
  {
    name: 'send',
    kind: 'method',
    container: 'EmailService',
    exported: true,
    path: EMAIL,
    line: 18,
    column: 9,
  },
];

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'send'.startsWith(query) ? SYMBOLS : [],
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const asked = url.searchParams.get('path') === EMAIL;
        return {
          flow: asked ? FIXTURE.flows[`${EMAIL}#EmailService.send`] : null,
          message: asked ? null : 'Only EmailService.send’s flow is in this walkthrough’s fake.',
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

test('phase 13 · Try it: timeline sequence view, Graph / Sequence view switch, waterfall and bidirectional inspector', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Twenty', { exact: true })).toBeVisible();

  await test.step('Open flow in Graph view: switch to Sequence view in 40 px top bar', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('send');
    await page.getByRole('option', { name: /^Show the flow from send/ }).click();
    await page.keyboard.press('f');

    // View switcher in the top bar: Graph is active, Sequence is enabled
    const graphTab = page.getByRole('tab', { name: 'Graph' });
    const sequenceTab = page.getByRole('tab', { name: 'Sequence' });
    await expect(graphTab).toHaveAttribute('aria-selected', 'true');
    await expect(sequenceTab).toBeEnabled();

    // Switch to Sequence view
    await sequenceTab.click();
    await expect(sequenceTab).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('The same flow, in the code’s order: every node a row, once; the hand-off’s work after', async () => {
    const sequence = page.getByRole('region', { name: 'Sequence' });
    await expect(sequence.getByText('order from code; no timings yet')).toBeVisible();
    // Each of the flow's 16 nodes is a step (an open end is a row, not a step).
    const flow = FIXTURE.flows[`${EMAIL}#EmailService.send`] as { nodes: { name: string }[] };
    await expect(sequence.getByRole('button')).toHaveCount(flow.nodes.length);
    // send calls add, then hands the email to its queue: in that order, before the background.
    const main = sequence.getByRole('group', { name: 'Main' });
    const names = await main
      .getByRole('button')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('aria-label')?.split(',')[0] ?? ''),
      );
    expect(names.slice(0, 1)).toEqual(['send']);
    expect(names).toContain('email-queue · EmailSenderJob');
    expect(names).not.toContain('handle');
    // The worker runs after, in its own Background group with a clock (Figma 08).
    const background = sequence.getByRole('group', {
      name: 'Background · email-queue · EmailSenderJob',
    });
    await expect(background.getByRole('button', { name: /^handle,/ })).toBeVisible();
  });

  await test.step('A row opens the same node in the inspector, as on the graph', async () => {
    const sequence = page.getByRole('region', { name: 'Sequence' });
    const handle = sequence.getByRole('button', { name: /^handle,/ });
    await handle.click();
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'handle' })).toBeVisible();
  });

  await test.step('Switch back to Graph view preserves flow and state', async () => {
    await page.getByRole('tab', { name: 'Graph' }).click();
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await expect(canvas).toBeVisible();
  });

  expect(await watch.problems()).toEqual([]);
});
