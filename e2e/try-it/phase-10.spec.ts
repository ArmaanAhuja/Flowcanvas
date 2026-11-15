import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 10 · Try it: in Documenso, a flow shows database reads and writes and outside services. In a real browser
// under the production CSP: find sendDocument with ⌘K, open its flow, read the Prisma database write and nodemailer
// external boundary on the canvas with their framework badges, and inspect each in the right panel.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000c7',
  '2026-11-15T09:00:00.000Z',
  'Documenso',
);

const SEND_DOCUMENT_PATH = 'packages/lib/server-only/document/send-document.ts';

const FLOW = {
  root: `${SEND_DOCUMENT_PATH}#sendDocument`,
  nodes: [
    {
      id: `${SEND_DOCUMENT_PATH}#sendDocument`,
      kind: 'code-unit',
      name: 'sendDocument',
      place: { path: SEND_DOCUMENT_PATH, line: 15, column: 14 },
      unit: 'function',
      change: 'unchanged',
    },
    {
      id: '(data prisma documents write)',
      kind: 'data-access',
      name: 'documents',
      place: null,
      unit: null,
      change: 'unchanged',
      data: {
        library: 'prisma',
        table: 'documents',
        operation: 'write',
        complete: true,
        why: null,
      },
    },
    {
      id: '(service email nodemailer)',
      kind: 'external-boundary',
      name: 'Email · nodemailer',
      place: null,
      unit: null,
      change: 'unchanged',
      service: {
        kind: 'email',
        library: 'nodemailer',
        url: null,
        complete: true,
        why: null,
      },
    },
  ],
  edges: [
    {
      from: `${SEND_DOCUMENT_PATH}#sendDocument`,
      to: '(data prisma documents write)',
      kind: 'data',
      relation: null,
      label: null,
      provenance: 'convention',
      lines: [45],
      sites: 1,
    },
    {
      from: `${SEND_DOCUMENT_PATH}#sendDocument`,
      to: '(service email nodemailer)',
      kind: 'boundary',
      relation: null,
      label: null,
      provenance: 'convention',
      lines: [72],
      sites: 1,
    },
  ],
  unknown: [],
  cut: [],
  hidden: 0,
  byProvenance: { observed: 0, resolved: 0, convention: 2, suggested: 0, unknown: 0 },
};

const VERSION = '10'.repeat(32);

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'senddocument'.startsWith(query)
            ? [
                {
                  name: 'sendDocument',
                  kind: 'function',
                  container: null,
                  exported: true,
                  path: SEND_DOCUMENT_PATH,
                  line: 15,
                  column: 14,
                },
              ]
            : [],
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const path = url.searchParams.get('path');
        const asked = path === SEND_DOCUMENT_PATH;
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

test('phase 10 · Try it: in Documenso, a flow shows database reads and writes and outside services', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Documenso', { exact: true })).toBeVisible();

  await test.step('Open sendDocument from ⌘K', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('sendDocument');
    await page.getByRole('option', { name: /^Show the flow from sendDocument/ }).click();
  });

  await test.step('The canvas shows the function, the documents database table, and the nodemailer service', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await expect(canvas.getByText('sendDocument', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('documents', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('write · Prisma', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('Email · nodemailer', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByRole('status')).toContainText('2 edges · 2 convention');
  });

  await test.step('Clicking the table node opens its Data access details in the inspector', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await canvas.getByText('documents', { exact: true }).first().click();

    const inspector = page.getByRole('region', { name: 'documents' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Data access', { exact: true })).toBeVisible();
    await expect(inspector.getByText('Prisma', { exact: true })).toBeVisible();
    await expect(inspector.getByText('Write', { exact: true })).toBeVisible();
    await expect(inspector).toContainText('Known by a library’s rule (convention)');
  });

  await test.step('Clicking the service node opens its External service details in the inspector', async () => {
    const canvas = page.getByRole('main', { name: 'Canvas' });
    await canvas.getByText('Email · nodemailer', { exact: true }).first().click();

    const inspector = page.getByRole('region', { name: 'Email · nodemailer' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('External service', { exact: true })).toBeVisible();
    await expect(inspector.getByText('nodemailer', { exact: true })).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});
