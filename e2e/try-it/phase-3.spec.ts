import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 3 · Try it: edit a file in Rallly, close the tab, reopen it: the change is still there. Built up step by
// step: this part (step 5) opens files in the Code view under the production CSP, edits and saves them, and
// shows a conflict. The workspace is a fake with real versions (SHA-256) and real conflict checks; the real one is
// proven by the Docker tests (workspace/host/src/host.docker.test.ts).

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000c3',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  workspace: {
    id: 'w-3',
    state: 'running',
    stateChangedAt: '2026-11-08T09:00:00.000Z',
    failure: null,
  },
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The workspace's files, as the agent would keep them. */
class FakeWorkspace {
  readonly files = new Map<string, string>([
    ['package.json', '{\n  "name": "rallly"\n}\n'],
    ['apps/web/src/utils/greeting.ts', 'export const greeting = "Hello";\n'],
    ['apps/web/public/logo.png', '\u0089PNG'],
  ]);

  /** The workspace's journal of unsaved changes, with the agent's rule: an older revision never replaces a newer. */
  readonly journal = new Map<
    string,
    {
      path: string;
      content: string;
      baseVersion: string | null;
      revision: number;
      updatedAt: number;
    }
  >();

  constructor(page: Page) {
    this.watch(page);
  }

  /** Serves a page from this workspace. Routed on the browser context, not the page: a request sent as a page
   * closes (keepalive) outlives the page, and the page's own routes go with it. */
  watch(page: Page): void {
    void page.context().route('**/api/**', (route) => this.answer(route));
  }

  private reply(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private answer(route: Route) {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    if (url.pathname === '/api/me') {
      return this.reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (url.pathname === '/api/projects')
      return this.reply(route, { projects: [PROJECT], workspacesAvailable: true });
    if (url.pathname.endsWith('/workspace/tree')) {
      return this.reply(route, {
        files: [...this.files.keys(), '.env.example'].sort(),
        truncated: false,
        source: 'git',
      });
    }
    if (url.pathname.endsWith('/workspace/journal')) {
      return this.reply(route, {
        entries: [...this.journal.values()].map((entry) => ({
          path: entry.path,
          revision: entry.revision,
        })),
      });
    }
    if (url.pathname.endsWith('/workspace/journal/entry')) {
      const method = route.request().method();
      if (method === 'PUT') {
        const body = route.request().postDataJSON() as {
          content: string;
          baseVersion: string | null;
          revision: number;
        };
        const existing = this.journal.get(path);
        if (existing === undefined || existing.revision <= body.revision) {
          this.journal.set(path, { path, ...body, updatedAt: Date.now() });
        }
        return this.reply(route, { path, revision: body.revision });
      }
      if (method === 'DELETE') {
        const existing = this.journal.get(path);
        if (
          existing !== undefined &&
          existing.revision <= Number(url.searchParams.get('revision'))
        ) {
          this.journal.delete(path);
        }
        return this.reply(route, { path, dropped: true });
      }
      const entry = this.journal.get(path);
      return entry === undefined
        ? this.reply(
            route,
            { error: 'There are no unsaved changes for that file.', code: 'not_found' },
            404,
          )
        : this.reply(route, entry);
    }
    if (url.pathname.endsWith('/workspace/file')) {
      if (path.split('/').pop() === '.env.example') {
        return this.reply(
          route,
          { error: 'There’s nothing at that path.', code: 'not_found' },
          404,
        );
      }
      const content = this.files.get(path);
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as {
          content: string;
          baseVersion: string | null;
        };
        const current = content === undefined ? null : sha(content);
        if (body.baseVersion !== current) {
          return this.reply(
            route,
            { error: 'This file changed in the workspace since you opened it.', code: 'conflict' },
            409,
          );
        }
        this.files.set(path, body.content);
        return this.reply(route, { path, size: body.content.length, version: sha(body.content) });
      }
      if (content === undefined)
        return this.reply(
          route,
          { error: 'There’s nothing at that path.', code: 'not_found' },
          404,
        );
      if (path.endsWith('.png')) {
        return this.reply(route, {
          path,
          size: 4,
          encoding: 'base64',
          content: 'iVBORw==',
          version: sha(content),
        });
      }
      return this.reply(route, {
        path,
        size: content.length,
        encoding: 'utf8',
        content,
        version: sha(content),
      });
    }
    return this.reply(route, { error: 'not found' }, 404);
  }
}

const row = (page: Page, name: string) =>
  page.getByRole('row', { name: new RegExp(`^${name.replace('.', '\\.')}($|,)`) });

test('phase 3: open a file in the Code view, edit it, save it, and see a conflict', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  const workspace = new FakeWorkspace(page);
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
    await expect(page.getByRole('alert')).toHaveText(
      'This file changed in the workspace since you opened it. Your changes are still here, not saved.',
    );
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
  const workspace = new FakeWorkspace(page);
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
      baseVersion: createHash('sha256').update('{\n  "name": "rallly"\n}\n').digest('hex'),
      revision: Date.now(),
      updatedAt: Date.now(),
    });
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const elsewhere = await other.newPage();
    workspace.watch(elsewhere);
    await elsewhere.goto(`/p/${PROJECT.id}`);
    await elsewhere.getByRole('tab', { name: 'Code' }).click();
    await expect(
      elsewhere.getByRole('button', { name: 'package.json, unsaved changes', exact: true }),
    ).toBeVisible();
    await expect(elsewhere.locator('.cm-content')).toContainText('"private": true');
    await other.close();
  });
});
