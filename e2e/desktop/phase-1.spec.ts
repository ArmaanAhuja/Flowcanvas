// Phases 1 and 2 of the build plan v2, in the real Electron app on a copy of Rallly at its pin:
// - phase 1 · Done when: the app opens Rallly and shows its files and search;
// - phase 2 · Done when: an edit in the app is on disk at once; an edit from elsewhere shows in the app within 1 s.
// Open folder goes through the real IPC and folder picker, with the system dialog's answer stubbed in Electron.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { accessibilityProblems } from '../accessibility.js';
import { cloneFork, launchApp } from './support.js';

const FILE = 'apps/web/src/features/poll/mutations.ts';

let base: string;
let folder: string;
let app: ElectronApplication;

test.beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'fc-desktop-e2e-'));
  folder = cloneFork('rallly', base);
});
test.afterAll(async () => {
  await app.close();
  rmSync(base, { recursive: true, force: true });
});

async function launch(args: readonly string[]): Promise<Page> {
  const launched = await launchApp(base, args);
  app = launched.app;
  return launched.page;
}

test('phases 1 and 2 · Try it: open Rallly from the start screen, search, edit, see an outside edit', async () => {
  const page = await launch([]);

  await test.step('The start screen: Open folder, through the system’s folder picker', async () => {
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('Open a project folder to start.', { exact: false })).toBeVisible();
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, folder);
    await page.getByRole('button', { name: 'Open folder' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]+$/);
    await expect(page.getByText('rallly', { exact: true })).toBeVisible();
  });

  await test.step('Phase 1: its files, and search once it’s indexed', async () => {
    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('row', { name: /^apps($|,)/ })).toBeVisible();
    // Search answers once the engine has read the folder (Rallly: seconds): asked through the app's own API.
    const projectId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/projects/${id}/workspace/index/status`);
            return ((await response.json()) as { state?: string }).state;
          }, projectId),
        { timeout: 120_000, intervals: [1000] },
      )
      .toBe('ready');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('createpol');
    await expect(
      page.getByRole('option', {
        name: 'createPoll, function, apps/web/src/features/poll/mutations.ts:98',
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'File path' })).toContainText('mutations.ts');
  });

  await test.step('Phase 2: an edit in the app is on disk at once', async () => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// edited in Flowcanvas');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    expect(readFileSync(join(folder, FILE), 'utf8')).toContain('// edited in Flowcanvas');
  });

  await test.step('Phase 2: an edit from elsewhere shows in the app within a second', async () => {
    const before = readFileSync(join(folder, FILE), 'utf8');
    writeFileSync(
      join(folder, FILE),
      before.replace('// edited in Flowcanvas', '// edited elsewhere'),
    );
    const started = Date.now();
    await expect(page.locator('.cm-content')).toContainText('// edited elsewhere', {
      timeout: 1000,
    });
    console.log(
      `desktop: an outside edit reached the editor in ${String(Date.now() - started)} ms`,
    );
  });

  await test.step('The start screen lists it as a recent project', async () => {
    await page.goto(new URL('/', page.url()).toString());
    const recent = page.getByRole('list', { name: 'Recent projects' });
    await expect(recent.getByRole('link', { name: 'rallly' })).toBeVisible();
    await expect(recent.getByText(folder)).toBeVisible();
    expect(await accessibilityProblems(page, { electron: true })).toEqual([]);
  });
});
