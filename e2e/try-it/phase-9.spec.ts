import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 9 · Try it: in Rallly, open the "Create poll" submit; the flow continues into the API handler. In a real
// browser under the production CSP: CreatePoll (whose form's submit runs makePoll.mutateAsync) found with ⌘K, its flow
// crossing from the form into the tRPC procedure polls.make and on to its handler, the link badged with its framework.
// The workspace is a fake answering with the engine's own flow for Rallly at its pin (fixtures/phase-9-rallly.json,
// buildFlow on its graph); the engine is held to every labelled connector site, and to this crossing in all 4 forks,
// by the Docker corpus test.

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c9', '2026-11-15T09:00:00.000Z');
const CREATE_POLL = 'apps/web/src/features/poll/components/create-poll.tsx';
const ROOT = `${CREATE_POLL}#CreatePoll`;
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-9-rallly.json', import.meta.url), 'utf8'),
) as { flows: Record<string, unknown> };
const VERSION = '9'.repeat(64);

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'createpoll'.startsWith(query)
            ? [
                {
                  name: 'CreatePoll',
                  kind: 'function',
                  container: null,
                  exported: true,
                  path: CREATE_POLL,
                  line: 115,
                  column: 14,
                },
              ]
            : [],
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const asked = url.searchParams.get('path') === CREATE_POLL;
        return {
          flow: asked ? FIXTURE.flows[ROOT] : null,
          message: asked ? null : 'Only CreatePoll’s flow is in this walkthrough’s fake.',
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

test('phase 9 · Try it: in Rallly, the Create poll submit’s flow continues into the API handler', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Rallly', { exact: true })).toBeVisible();

  await test.step('⌘K to CreatePoll, the component whose form submits the poll: Show its flow', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('CreatePoll');
    await page.getByRole('option', { name: /^Show the flow from CreatePoll/ }).click();
  });

  await test.step('The submit crosses into the tRPC procedure polls.make and its handler, badged tRPC', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await expect(canvas.getByRole('status')).toContainText('convention');
    await page.keyboard.press('f');
    // 60 nodes: grouped (phase 12). The procedure and its handler are in the tRPC routers' folder: opened.
    await canvas.getByRole('button', { name: 'trpc/routers, 2 nodes' }).click();
    await page.keyboard.press('f');
    // The procedure's entry point, and its handler (an anonymous unit named after it, ADR 0030 §3).
    await expect(canvas.getByText('mutation polls.make', { exact: true })).toHaveCount(2);
    await expect(canvas.getByText('tRPC', { exact: true }).first()).toBeAttached();
  });

  expect(await watch.problems()).toEqual([]);
});
