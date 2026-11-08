// Named import: the package's type entry is CommonJS, so its default export doesn't type-check under nodenext.
import { AxeBuilder } from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { THEMES, type Theme } from './storybook.js';

// The app's implemented screens (phase 2 onwards), from the production build with a fake API, in both themes:
// pixel-compared with their approved baselines and checked with axe. Figma 06 is the owner's reference by eye;
// these baselines are what catches an unintended change. Update deliberately: pnpm test:visual:update.

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000b2',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: null,
  createdAt: '2026-11-07T09:00:00.000Z',
  workspace: {
    id: 'w-1',
    state: 'sleeping',
    stateChangedAt: '2026-11-07T09:30:00.000Z',
    failure: null,
  },
};

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** The Code view's files (phase 3): real content, real versions. */
const FILES: Record<string, string> = {
  'apps/web/src/utils/greeting.ts':
    "// Greets a person by name.\nexport function greet(name: string): string {\n  const hour = new Date().getHours();\n  return hour < 12 ? `Good morning, ${name}` : `Hello, ${name}`;\n}\n\nexport const DEFAULT_NAME = 'there';\n",
  'apps/web/src/pages/index.tsx': 'export default function Home() {\n  return null;\n}\n',
  'package.json': '{\n  "name": "rallly",\n  "private": true\n}\n',
  'README.md': '# Rallly\n',
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface ApiOptions {
  readonly running?: boolean;
  /** A journal entry for this file, whose base is older than the file: the restore shows a conflict. */
  readonly staleDraft?: string;
}

async function fakeApi(page: Page, options: ApiOptions = {}): Promise<void> {
  const project =
    options.running === true
      ? { ...PROJECT, workspace: { ...PROJECT.workspace, state: 'running' } }
      : PROJECT;
  // The file watcher's socket: open and quiet (page routes don't cover WebSockets, which would reach for the
  // real API and retry).
  await page.routeWebSocket(/\/workspace\/events$/, () => undefined);
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const file = url.searchParams.get('path') ?? '';
    if (path.endsWith('/workspace/tree')) {
      return reply(route, { files: Object.keys(FILES).sort(), truncated: false, source: 'git' });
    }
    if (path.endsWith('/workspace/file')) {
      const content = FILES[file];
      return content === undefined
        ? reply(route, { error: 'There’s nothing at that path.', code: 'not_found' }, 404)
        : reply(route, {
            path: file,
            size: content.length,
            encoding: 'utf8',
            content,
            version: sha(content),
          });
    }
    if (path.endsWith('/workspace/journal')) {
      return reply(route, { entries: [] });
    }
    if (path.endsWith('/workspace/journal/entry')) {
      return options.staleDraft === file
        ? reply(route, {
            path: file,
            content: `${FILES[file] ?? ''}// my unsaved line\n`,
            baseVersion: sha('an older version'),
            revision: 1,
            updatedAt: Date.UTC(2026, 10, 7, 9, 41),
            size: 1,
          })
        : reply(route, { error: 'none', code: 'not_found' }, 404);
    }
    if (path === '/api/me') {
      return reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (path === '/api/projects')
      return reply(route, { projects: [project], workspacesAvailable: true });
    if (path === '/api/usage') {
      return reply(route, {
        usage: {
          periodStart: '2026-11-01T00:00:00.000Z',
          resetsAt: '2026-12-01T00:00:00.000Z',
          workspaceSeconds: 5_400,
          storageByteHours: 0,
        },
      });
    }
    return reply(route, { error: 'not found' }, 404);
  });
}

interface Screen {
  readonly name: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly stressTest?: boolean;
  /** The Code view with these tabs open, the first shown (phase 3); the workspace runs. */
  readonly code?: readonly string[];
  readonly api?: ApiOptions;
  /** Brings the page into the state to capture, after it has loaded. */
  readonly arrange?: (page: Page) => Promise<void>;
}

const SCREENS: readonly Screen[] = [
  { name: 'project-empty' },
  { name: 'project-empty-1280', viewport: { width: 1280, height: 800 } },
  { name: 'project-stress-test', stressTest: true },
  {
    name: 'project-review-open',
    arrange: async (page) => {
      await page.getByRole('button', { name: 'Show review' }).click();
    },
  },
  {
    name: 'project-full-screen',
    stressTest: true,
    arrange: async (page) => {
      await page.getByRole('button', { name: 'Full-screen canvas' }).click();
      await page.getByRole('button', { name: 'Fit (F)' }).click();
    },
  },
  {
    name: 'project-workspace-popover',
    arrange: async (page) => {
      await page.getByRole('button', { name: 'Workspace: Sleeping' }).click();
      await expect(page.getByRole('dialog', { name: 'Workspace' })).toContainText('This month');
    },
  },
  // Phase 3: the Code view (Figma 11), a restored change whose file moved on, and quick-open (Figma 16).
  { name: 'code-view', code: ['apps/web/src/utils/greeting.ts', 'package.json'] },
  {
    name: 'code-conflict',
    code: ['apps/web/src/utils/greeting.ts'],
    api: { staleDraft: 'apps/web/src/utils/greeting.ts' },
  },
  {
    name: 'code-quick-open',
    code: ['apps/web/src/utils/greeting.ts'],
    arrange: async (page) => {
      await page.keyboard.press('Control+p');
      await expect(page.getByRole('searchbox', { name: 'File name' })).toBeFocused();
      await page.keyboard.type('page');
      await expect(page.getByRole('option')).toHaveCount(2);
    },
  },
];

async function open(page: Page, screen: Screen, theme: Theme): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00.000Z'));
  await fakeApi(page, { ...screen.api, ...(screen.code === undefined ? {} : { running: true }) });
  await page.addInitScript(
    ([chosen, labs, code, projectId]) => {
      window.localStorage.setItem('flowcanvas-theme', chosen);
      if (labs) {
        window.localStorage.setItem(
          'flowcanvas-labs',
          JSON.stringify({ 'canvas-stress-test': true }),
        );
      }
      if (code.length > 0) {
        window.localStorage.setItem(`flowcanvas-view-${projectId}`, 'code');
        window.localStorage.setItem(
          `flowcanvas-code-${projectId}`,
          JSON.stringify({ open: code, active: code[0] }),
        );
      }
    },
    [theme, screen.stressTest === true, screen.code ?? [], PROJECT.id] as const,
  );
  await page.setViewportSize(screen.viewport ?? { width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.locator('[data-region="canvas"]')).toBeVisible();
  if (screen.stressTest === true) await expect(page.locator('.react-flow__node')).toHaveCount(500);
  if (screen.code !== undefined) {
    // Every tab loaded and the shown file in the editor, its language's colours applied.
    await expect(page.locator('.cm-content')).toContainText('export function greet');
    await expect(page.getByRole('treegrid', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Editor status' })).toContainText('TypeScript');
  }
  await screen.arrange?.(page);
  await page.evaluate(() => document.fonts.ready);
  // React Flow's fit and zoom are animated through the viewport transform: wait until it stops moving.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const viewport = document.querySelector('.react-flow__viewport');
        const before = viewport?.getAttribute('style');
        setTimeout(() => {
          resolve(viewport?.getAttribute('style') === before);
        }, 400);
      }),
  );
}

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    test(`${screen.name} · ${theme}`, async ({ page }) => {
      await open(page, screen, theme);

      await expect(page).toHaveScreenshot(`screens-${screen.name}-${theme}.png`);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const violations = results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
      expect(violations).toEqual([]);
    });
  }
}
