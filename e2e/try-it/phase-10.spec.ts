import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 10 · Try it: in Documenso, open "Send document"; see the database writes and the email boundary. In a real
// browser under the production CSP: sendDocument's flow with its Prisma writes (Envelope, Recipient, DocumentMeta…),
// one opened in the inspector; then the signing email's job runner (send-signing-email.handler.ts's run, what
// sendDocument's triggerJob hands the email to) with its nodemailer boundary. The workspace is a fake answering with
// the engine's own flows for Documenso at its pin (fixtures/phase-10-documenso.json, buildFlow on its graph); the
// whole chain, sendDocument → the job → its handler → the email, is held in a real workspace by the Docker corpus test.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000ca',
  '2026-11-15T09:00:00.000Z',
  'Documenso',
);
const SEND = 'packages/lib/server-only/document/send-document.ts';
const RUN = 'packages/lib/jobs/definitions/emails/send-signing-email.handler.ts';
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-10-documenso.json', import.meta.url), 'utf8'),
) as { flows: Record<string, unknown> };
const VERSION = 'a'.repeat(64);

const SYMBOLS = [
  { name: 'sendDocument', path: SEND, line: 56, column: 14 },
  { name: 'run', path: RUN, line: 31, column: 14 },
];

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: SYMBOLS.filter((s) => s.name.toLowerCase().startsWith(query)).map((s) => ({
            ...s,
            kind: 'function',
            container: null,
            exported: true,
          })),
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const path = url.searchParams.get('path');
        const flow =
          path === SEND
            ? FIXTURE.flows[`${SEND}#sendDocument`]
            : path === RUN
              ? FIXTURE.flows[`${RUN}#run`]
              : undefined;
        return {
          flow: flow ?? null,
          message: flow === undefined ? 'Not in this walkthrough’s fake.' : null,
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

const showFlow = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Search' }).click();
  await page.keyboard.type(name);
  await page.getByRole('option', { name: new RegExp(`^Show the flow from ${name}`) }).click();
};

test('phase 10 · Try it: in Documenso, Send document’s database writes and its email boundary', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Documenso', { exact: true })).toBeVisible();
  const canvas = page.getByRole('main', { name: 'Canvas' });

  await test.step('sendDocument’s flow: its Prisma writes, each badged Prisma', async () => {
    await showFlow(page, 'sendDocument');
    await expect(canvas.getByRole('status')).toContainText('convention');
    await page.keyboard.press('f');
    for (const table of ['Envelope', 'Recipient', 'DocumentMeta', 'DocumentAuditLog', 'Field']) {
      await expect(canvas.getByText(table, { exact: true }).first()).toBeAttached();
    }
    await expect(canvas.getByText('write · Prisma').first()).toBeAttached();
    await expect(canvas.getByText('Prisma', { exact: true }).first()).toBeAttached();
  });

  await test.step('A write in the inspector: its table, access and library, how it’s known', async () => {
    await canvas.locator('[data-id="(data prisma Envelope write)"]').click();
    const inspector = page.getByRole('region', { name: 'Envelope' });
    await expect(inspector).toContainText('Data access');
    await expect(inspector).toContainText('Write');
    await expect(inspector).toContainText('Prisma');
    await expect(inspector).toContainText('convention');
  });

  await test.step('The signing email’s job runner: the nodemailer boundary', async () => {
    await showFlow(page, 'run');
    await page.keyboard.press('f');
    await expect(canvas.getByText('Email · nodemailer', { exact: true })).toBeAttached();
    await canvas.locator('[data-id="(service email nodemailer)"]').click();
    const inspector = page.getByRole('region', { name: 'Email · nodemailer' });
    await expect(inspector).toContainText('External service');
    await expect(inspector).toContainText('nodemailer');
  });

  expect(watch.problems()).toEqual([]);
});
