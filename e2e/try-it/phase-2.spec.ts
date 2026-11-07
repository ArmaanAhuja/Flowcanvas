import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 2 · Try it: pan, zoom and collapse panels; compare with Figma 06. Built up step by step: this part
// opens a project's page and checks the shell's regions against Figma 06's sizes (step 2).

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000b2',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: null,
  createdAt: '2026-11-07T09:00:00.000Z',
  workspace: {
    id: 'w-1',
    state: 'running',
    stateChangedAt: '2026-11-07T09:00:00.000Z',
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
          workspaceSeconds: 0,
          storageByteHours: 0,
        },
      });
    }
    return reply(route, { error: 'not found' }, 404);
  });
}

/** Figma 06's shell (generator script, shell()): top bar 40, rail 44, left 248, right 360, review bar 40. */
function expected(width: number, height: number) {
  return {
    'top-bar': { x: 0, y: 0, width, height: 40 },
    rail: { x: 0, y: 40, width: 44, height: height - 80 },
    'left-panel': { x: 44, y: 40, width: 248, height: height - 80 },
    canvas: { x: 292, y: 40, width: width - 44 - 248 - 360, height: height - 80 },
    'right-panel': { x: width - 360, y: 40, width: 360, height: height - 80 },
    'review-bar': { x: 0, y: height - 40, width, height: 40 },
  };
}

test('phase 2: a project opens in the app shell, laid out like Figma 06', async ({ page }) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);

  await test.step('From the projects list, the project’s name opens its page', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Rallly' }).click();
    await expect(page).toHaveURL(`/p/${PROJECT.id}`);
    await expect(page.getByRole('banner')).toContainText('Rallly');
  });

  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await test.step(`Every region at Figma's size, at ${String(width)} × ${String(height)}`, async () => {
      await page.setViewportSize({ width, height });
      for (const [region, box] of Object.entries(expected(width, height))) {
        const actual = await page.locator(`[data-region="${region}"]`).boundingBox();
        expect(actual, region).toEqual(box);
      }
    });
  }

  await test.step('A reload at the project’s address lands on the same page', async () => {
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('Rallly');
  });

  expect(watch.problems()).toEqual([]);
});
