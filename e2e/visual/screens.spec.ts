// Named import: the package's type entry is CommonJS, so its default export doesn't type-check under nodenext.
import { AxeBuilder } from '@axe-core/playwright';
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

async function fakeApi(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      return reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (path === '/api/projects')
      return reply(route, { projects: [PROJECT], workspacesAvailable: true });
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
];

async function open(page: Page, screen: Screen, theme: Theme): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00.000Z'));
  await fakeApi(page);
  await page.addInitScript(
    ([chosen, labs]) => {
      window.localStorage.setItem('flowcanvas-theme', chosen);
      if (labs) {
        window.localStorage.setItem(
          'flowcanvas-labs',
          JSON.stringify({ 'canvas-stress-test': true }),
        );
      }
    },
    [theme, screen.stressTest === true] as const,
  );
  await page.setViewportSize(screen.viewport ?? { width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.locator('[data-region="canvas"]')).toBeVisible();
  if (screen.stressTest === true) await expect(page.locator('.react-flow__node')).toHaveCount(500);
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
