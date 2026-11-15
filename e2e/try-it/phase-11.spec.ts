import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 11 · Try it: in Twenty, open a job flow and see the background lane. In a real browser under the production
// CSP: EmailService.send found with ⌘K, its flow enqueueing on the email queue (messageQueueService.add), the hand-off
// with its clock, and the worker (EmailSenderJob.handle, the @Process method of the queue's @Processor) and what it
// runs in the framed Background lane; the hand-off in the inspector. The workspace is a fake answering with the
// engine's own flow for Twenty at its pin (fixtures/phase-11-twenty.json, buildFlow on its graph); the chain enqueue
// → queue → worker → result is held in a real workspace by the Docker corpus test.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000cb',
  '2026-11-15T09:00:00.000Z',
  'Twenty',
);
const EMAIL = 'packages/twenty-server/src/engine/core-modules/email/email.service.ts';
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-11-twenty.json', import.meta.url), 'utf8'),
) as { flows: Record<string, unknown> };
const HANDOFF = '(handoff queue:email-queue/EmailSenderJob)';
const VERSION = 'b'.repeat(64);

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'send'.startsWith(query)
            ? [
                {
                  name: 'send',
                  kind: 'method',
                  container: 'EmailService',
                  exported: true,
                  path: EMAIL,
                  line: 18,
                  column: 9,
                },
              ]
            : [],
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

test('phase 11 · Try it: in Twenty, a job flow’s hand-off and its background lane', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Twenty', { exact: true })).toBeVisible();
  const canvas = page.getByRole('main', { name: 'Canvas' });

  await test.step('⌘K to EmailService.send: Show its flow', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.keyboard.type('send');
    await page.getByRole('option', { name: /^Show the flow from send/ }).click();
    await expect(canvas.getByRole('status')).toContainText('convention');
    await page.keyboard.press('f');
  });

  await test.step('The email queue’s hand-off, with a clock, and the worker in the Background lane', async () => {
    await expect(canvas.getByText('email-queue · EmailSenderJob', { exact: true })).toBeAttached();
    await expect(canvas.getByRole('img', { name: 'Handed off' }).first()).toBeAttached();
    const lane = canvas.getByRole('group', { name: 'Background lane' });
    await expect(lane).toBeAttached();
    // The worker sits inside the lane's frame, below the main flow.
    const laneBox = await lane.boundingBox();
    const worker = await canvas
      .locator(
        '[data-id="packages/twenty-server/src/engine/core-modules/email/email-sender.job.ts#EmailSenderJob.handle"]',
      )
      .boundingBox();
    const sender = await canvas.locator(`[data-id="${EMAIL}#EmailService.send"]`).boundingBox();
    expect(laneBox).not.toBeNull();
    expect(worker?.y ?? 0).toBeGreaterThan(laneBox?.y ?? Infinity);
    expect(sender?.y ?? Infinity).toBeLessThan(laneBox?.y ?? 0);
  });

  await test.step('The hand-off in the inspector: its kind and name, and the worker that takes it', async () => {
    await canvas.locator(`[data-id="${HANDOFF}"]`).click();
    const inspector = page.getByRole('region', { name: 'email-queue · EmailSenderJob' });
    await expect(inspector).toContainText('Async hand-off');
    await expect(inspector).toContainText('Queue');
    await expect(inspector).toContainText('message-queue');
    await expect(inspector.getByRole('list', { name: 'Handled by' })).toContainText('handle');
  });

  expect(watch.problems()).toEqual([]);
});
