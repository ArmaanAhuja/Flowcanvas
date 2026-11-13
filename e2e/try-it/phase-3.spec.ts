import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject, sha } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 3 · Try it: edit a file in Rallly, close the tab, reopen it: the change is still there. Built up step by
// step: this part (step 5) opens files in the Code view under the production CSP, edits and saves them, and
// shows a conflict. The workspace is a fake with real versions (SHA-256) and real conflict checks; the real one is
// proven by the Docker tests (workspace/host/src/host.docker.test.ts).

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c3', '2026-11-08T09:00:00.000Z');

/** The workspace's files, as the agent would keep them; `.env.example` is listed but never read. */
const fakeWorkspace = (page: Page) =>
  new FakeWorkspace(page, {
    project: PROJECT,
    files: {
      'package.json': '{\n  "name": "rallly"\n}\n',
      'apps/web/src/utils/greeting.ts': 'export const greeting = "Hello";\n',
    },
    binary: { 'apps/web/public/logo.png': 'iVBORw==' },
    unreadable: ['.env.example'],
  });

const row = (page: Page, name: string) =>
  page.getByRole('row', { name: new RegExp(`^${name.replace('.', '\\.')}($|,)`) });

test('phase 3: open a file in the Code view, edit it, save it, and see a conflict', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  const workspace = fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);

  await test.step('The Code view lists the project’s files', async () => {
    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
    await expect(page.getByText('Choose a file on the left to open it.')).toBeVisible();
  });

  await test.step('A file opens in CodeMirror, with its tab, path and status', async () => {
    for (const folder of ['apps', 'web', 'src', 'utils']) await row(page, folder).click();
    await row(page, 'greeting.ts').click();
    await expect(page.locator('.cm-content')).toContainText('export const greeting = "Hello";');
    await expect(page.getByRole('button', { name: 'greeting.ts', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('navigation', { name: 'File path' })).toContainText('greeting.ts');
    await expect(page.getByRole('group', { name: 'Editor status' })).toContainText('TypeScript');
  });

  await test.step('Typing marks it unsaved; F, V and H type letters, they don’t drive the canvas', async () => {
    // The first line: a click in the middle of the editor would land below the last line.
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' // fvh');
    await expect(page.locator('.cm-content')).toContainText('// fvh');
    await expect(
      page.getByRole('button', { name: 'greeting.ts, unsaved changes', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: 'greeting.ts, open in the editor, unsaved changes' }),
    ).toBeVisible();
  });

  await test.step('Ctrl+S saves it to the workspace, from the version it was opened at', async () => {
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toHaveText('Saved');
    await expect(page.getByRole('button', { name: 'greeting.ts', exact: true })).toBeVisible();
    expect(workspace.files.get('apps/web/src/utils/greeting.ts')).toBe(
      'export const greeting = "Hello"; // fvh\n',
    );
  });

  await test.step('A change made in the workspace meanwhile (the terminal) is never overwritten', async () => {
    workspace.files.set(
      'apps/web/src/utils/greeting.ts',
      'export const greeting = "Hi from the terminal";\n',
    );
    await page.keyboard.type('!');
    await page.keyboard.press('Control+s');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(
      'This file changed in the workspace since you opened it. Your changes are still here, not saved.',
    );
    // The two ways out (step 7); choosing is the step 7 walkthrough's.
    await expect(alert.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Load the workspace’s version' })).toBeVisible();
    expect(workspace.files.get('apps/web/src/utils/greeting.ts')).toBe(
      'export const greeting = "Hi from the terminal";\n',
    );
    await expect(page.locator('.cm-content')).toContainText('// fvh!');
  });

  await test.step('A binary file says what it is instead of showing garbled text', async () => {
    await row(page, 'public').click();
    await row(page, 'logo.png').click();
    await expect(
      page.getByText(
        'This file isn’t text (an image, a font or similar), so it can’t be edited here.',
      ),
    ).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});

test('phase 3 · Try it: edit a file, close the tab, reopen it: the change is still there', async ({
  browser,
  page,
}) => {
  const watch = watchForPageProblems(page);
  const workspace = fakeWorkspace(page);
  const greeting = 'apps/web/src/utils/greeting.ts';
  // Test-only: records requests sent with keepalive (as the page closes) in the app's own storage, for the
  // reopened tab to read: Playwright's routing can't see them.
  await page.context().addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.keepalive === true) {
        const log = JSON.parse(localStorage.getItem('e2e-keepalive') ?? '[]') as unknown[];
        log.push({ url: input instanceof Request ? input.url : input.toString(), body: init.body });
        localStorage.setItem('e2e-keepalive', JSON.stringify(log));
      }
      return original(input, init);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);

  await test.step('Edit a file in Rallly', async () => {
    await page.getByRole('tab', { name: 'Code' }).click();
    for (const folder of ['apps', 'web', 'src', 'utils']) await row(page, folder).click();
    await row(page, 'greeting.ts').click();
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' // kept');
    await expect(
      page.getByRole('button', { name: 'greeting.ts, unsaved changes', exact: true }),
    ).toBeVisible();
  });

  await test.step('Close the tab at once, before autosave: the changes go out as it closes', async () => {
    expect(watch.problems()).toEqual([]);
    await page.close({ runBeforeUnload: true });
    expect(workspace.files.get(greeting)).toBe('export const greeting = "Hello";\n');
  });

  await test.step('Reopen it: the change is still there, marked unsaved, and says so', async () => {
    const reopened = await page.context().newPage();
    const reopenedWatch = watchForPageProblems(reopened);
    await reopened.setViewportSize({ width: 1440, height: 900 });
    await reopened.goto(`/p/${PROJECT.id}`);
    await expect(reopened.locator('.cm-content')).toContainText(
      'export const greeting = "Hello"; // kept',
    );
    await expect(
      reopened.getByRole('button', { name: 'greeting.ts, unsaved changes', exact: true }),
    ).toBeVisible();
    await expect(reopened.getByText(/^Restored unsaved changes from /)).toBeVisible();
    // The workspace's copy: the 2-second write if the tab lived that long, else the write sent as it closed
    // (a keepalive request, which outlives the page; Playwright can't intercept those, so the page records the
    // attempt, test-only, below).
    const sentOnClose = await reopened.evaluate(
      () =>
        JSON.parse(localStorage.getItem('e2e-keepalive') ?? '[]') as {
          url: string;
          body: string;
        }[],
    );
    const kept = 'export const greeting = "Hello"; // kept\n';
    expect(
      workspace.journal.get(greeting)?.content === kept ||
        sentOnClose.some(
          (sent) =>
            sent.url.includes('/journal/entry') &&
            (JSON.parse(sent.body) as { content: string }).content === kept,
        ),
    ).toBe(true);
    await test.step('Autosave writes it after 5 seconds without typing', async () => {
      await reopened.locator('.cm-line').first().click();
      await reopened.keyboard.press('End');
      await reopened.keyboard.type('!');
      await expect
        .poll(() => workspace.files.get(greeting), { timeout: 12_000 })
        .toBe('export const greeting = "Hello"; // kept!\n');
      await expect(reopened.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
      await expect.poll(() => workspace.journal.has(greeting)).toBe(false);
    });
    expect(reopenedWatch.problems()).toEqual([]);
    await reopened.close();
  });

  await test.step('Another browser (nothing kept in it) restores from the workspace alone', async () => {
    workspace.journal.set('package.json', {
      path: 'package.json',
      content: '{\n  "name": "rallly",\n  "private": true\n}\n',
      baseVersion: sha('{\n  "name": "rallly"\n}\n'),
      revision: Date.now(),
      updatedAt: Date.now(),
    });
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const elsewhere = await other.newPage();
    await workspace.watch(elsewhere);
    await elsewhere.goto(`/p/${PROJECT.id}`);
    await elsewhere.getByRole('tab', { name: 'Code' }).click();
    await expect(
      elsewhere.getByRole('button', { name: 'package.json, unsaved changes', exact: true }),
    ).toBeVisible();
    await expect(elsewhere.locator('.cm-content')).toContainText('"private": true');
    await other.close();
  });
});

test('phase 3: an edit made in the terminal appears in the editor; quick-open; a deleted file', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  const workspace = fakeWorkspace(page);
  const greeting = 'apps/web/src/utils/greeting.ts';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await page.getByRole('tab', { name: 'Code' }).click();
  for (const folder of ['apps', 'web', 'src', 'utils']) await row(page, folder).click();
  await row(page, 'greeting.ts').click();
  await expect(page.locator('.cm-content')).toContainText('export const greeting = "Hello";');
  await expect.poll(() => workspace.watchers.length).toBeGreaterThan(0);

  await test.step('The terminal edits the file: the editor shows it (Done when)', async () => {
    workspace.terminalWrites(greeting, 'export const greeting = "Hello from the terminal";\n');
    await expect(page.locator('.cm-content')).toContainText('"Hello from the terminal"');
    await expect(page.getByRole('button', { name: 'greeting.ts', exact: true })).toBeVisible();
  });

  await test.step('With unsaved changes, it says so instead, and the person chooses', async () => {
    await page.locator('.cm-line').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' // mine');
    workspace.terminalWrites(greeting, 'export const greeting = "Theirs";\n');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(
      'This file changed in the workspace while you were editing it.',
    );
    await alert.getByRole('button', { name: 'Load the workspace’s version' }).click();
    await expect(page.locator('.cm-content')).toContainText('"Theirs"');
    await expect(page.locator('.cm-content')).not.toContainText('// mine');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  await test.step('Ctrl+P opens any file by name', async () => {
    await page.keyboard.press('Control+p');
    const dialog = page.getByRole('dialog', { name: 'Open a file' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('pack');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'package.json', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('.cm-content')).toContainText('"name": "rallly"');
  });

  await test.step('A file deleted in the terminal says so, and closes', async () => {
    await page.getByRole('button', { name: 'greeting.ts', exact: true }).click();
    workspace.terminalDeletes(greeting);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This file was deleted in the workspace.');
    await alert.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'greeting.ts', exact: true })).toHaveCount(0);
  });

  expect(watch.problems()).toEqual([]);
});
