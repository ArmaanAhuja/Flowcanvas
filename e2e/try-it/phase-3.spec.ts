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

  constructor(page: Page) {
    void page.route('**/api/**', (route) => this.answer(route));
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
