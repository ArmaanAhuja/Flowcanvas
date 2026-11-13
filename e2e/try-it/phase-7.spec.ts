import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { clickWord, watchForPageProblems } from './support.js';

// Phase 7 · Try it: pick any function in Documenso, open its flow, click nodes and read the inspector. In a real
// browser under the production CSP: deleteFolder found with ⌘K, its flow opened from the right-click menu and laid
// out by ELK in its Web Worker, its decisions and unknown calls on the canvas, a function's details in the inspector,
// and Open code at that function's line. The workspace is a fake answering with the engine's own flow and details
// for deleteFolder at Documenso's pin (fixtures/phase-7-delete-folder.json); the engine's flows for ten Documenso
// functions are checked against hand labels in real workspaces by the Docker corpus test.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000c7',
  '2026-11-13T09:00:00.000Z',
  'Documenso',
);

interface Place {
  readonly path: string;
  readonly line: number;
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-7-delete-folder.json', import.meta.url), 'utf8'),
) as {
  flow: unknown;
  details: Record<string, { details: { place: Place } | null; message: string | null }>;
};

const DELETE_FOLDER = 'packages/lib/server-only/folder/delete-folder.ts';
const GET_TEAM = 'packages/lib/server-only/team/get-team.ts';

/** A stand-in for a corpus file (its code isn't copied here): `lines` at their numbers, comments elsewhere. */
const fileWith = (lines: Record<number, string>, length: number) =>
  `${Array.from({ length }, (_, i) => lines[i + 1] ?? `// line ${String(i + 1)}`).join('\n')}\n`;

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    files: {
      [DELETE_FOLDER]: fileWith(
        { 14: 'export const deleteFolder = async ({ userId, teamId, folderId }) => {' },
        49,
      ),
      [GET_TEAM]: fileWith(
        { 38: 'export const getTeam = async ({ teamReference, userId }) => {' },
        84,
      ),
    },
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'deletefolder'.startsWith(query)
            ? [
                {
                  name: 'deleteFolder',
                  kind: 'function',
                  container: null,
                  exported: true,
                  path: DELETE_FOLDER,
                  line: 14,
                  column: 14,
                },
              ]
            : [],
          ms: 1,
        };
      },
      // Any place in deleteFolder's file opens its flow, as the engine's facts would say.
      '/workspace/index/flow': (url) =>
        url.searchParams.get('path') === DELETE_FOLDER
          ? FIXTURE.flow
          : {
              flow: null,
              message: 'No function here.',
              version: null,
              takenAt: null,
              current: true,
              complete: true,
            },
      '/workspace/index/details': (url) => {
        const path = url.searchParams.get('path');
        const line = Number(url.searchParams.get('line'));
        const found = Object.values(FIXTURE.details).find(
          (answer) => answer.details?.place.path === path && answer.details.place.line === line,
        );
        return found ?? { details: null, message: 'No function here.' };
      },
    },
  });
}

const status = (page: Page) => page.getByRole('group', { name: 'Editor status' });

test('phase 7 · Try it: open a Documenso function’s flow, click its nodes, read the inspector', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Documenso', { exact: true })).toBeVisible();

  await test.step('⌘K to deleteFolder: the Code view at its line', async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('deleteFolder');
    await expect(page.getByRole('option', { name: /^deleteFolder, function/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText('Ln 14, Col 14');
  });

  await test.step('Right-click its name → Show flow: the flow on the canvas, with how its edges are known', async () => {
    await clickWord(page, 'export const deleteFolder', 'deleteFolder');
    await page
      .getByRole('menu', { name: 'Code' })
      .getByRole('menuitem', { name: 'Show flow' })
      .click();
    const canvas = page.getByRole('main', { name: 'Canvas' });
    // The engine's flow: 13 edges reaching calls, 10 resolved, 3 unknown (Prisma's client isn't installed).
    await expect(canvas.getByRole('status')).toContainText('13 edges · 10 resolved · 3 unknown');
    // Opened at 100% on deleteFolder, near the top (owner, 14 Nov 2026); F fits the whole flow.
    const zoom = page.getByLabel('Zoom level');
    await expect(zoom).toHaveText('100%');
    await expect(canvas.getByText('deleteFolder', { exact: true }).last()).toBeInViewport();
    await page.keyboard.press('f');
    await expect(zoom).not.toHaveText('100%');
    for (const name of [
      'getTeamById',
      'getTeam',
      'buildTeamWhereQuery',
      'canAccessTeamDocument',
      'AppError',
    ]) {
      await expect(canvas.getByText(name, { exact: true }).first()).toBeVisible();
    }
    await expect(canvas.getByRole('img', { name: 'Decision: !folder' })).toBeVisible();
    await expect(canvas.getByRole('img', { name: 'Decision: !hasPermission' })).toBeVisible();
    await expect(canvas.getByText('2 unknown calls')).toBeVisible();
  });

  await test.step('Click getTeam: the inspector reads its code', async () => {
    await page.getByRole('main', { name: 'Canvas' }).getByText('getTeam', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Details', selected: true })).toBeVisible();
    const details = page.getByRole('region', { name: 'getTeam' });
    await expect(details).toContainText('{ teamReference: number | string; userId: number }');
    await expect(details).toContainText('prisma.team.findFirst');
    await expect(details).toContainText('!team');
  });

  await test.step('Open code: the Code view at getTeam’s line', async () => {
    await page.getByRole('button', { name: 'Open code' }).click();
    await expect(page.getByRole('textbox', { name: `Code: ${GET_TEAM}` })).toBeVisible();
    await expect(status(page)).toContainText('Ln 38, Col 14');
  });

  await test.step('Back to the flow, click a decision: its condition and where each outcome leads', async () => {
    await page.getByRole('tab', { name: 'Graph' }).click();
    await page
      .getByRole('main', { name: 'Canvas' })
      .getByRole('img', { name: 'Decision: !folder' })
      .click();
    const decision = page.getByRole('region', { name: 'Decision' });
    await expect(decision).toContainText('!folder');
    await expect(decision.getByRole('list', { name: 'Outcomes' })).toContainText('AppError');
  });

  expect(watch.problems()).toEqual([]);
});
