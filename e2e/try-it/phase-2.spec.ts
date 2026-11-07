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
  // Asleep, so the dock shows its message instead of connecting a terminal (the terminal's own walkthrough is 1d's).
  workspace: {
    id: 'w-1',
    state: 'sleeping',
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
        // Within 0.1 px: the panels are sized as flex proportions, and the browser lays them out in 1/64 px
        // units, so a region can be a sliver (1/64 px) off a whole pixel. Anything visible would be 1 px.
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(
            Math.abs((actual?.[key] ?? Number.NaN) - box[key]),
            `${region} ${key}`,
          ).toBeLessThan(0.1);
        }
      }
    });
  }

  await test.step('A reload at the project’s address lands on the same page', async () => {
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('Rallly');
  });

  expect(watch.problems()).toEqual([]);
});

const width = async (page: Page, region: string) =>
  (await page.locator(`[data-region="${region}"]`).boundingBox())?.width ?? 0;
const height = async (page: Page, region: string) =>
  (await page.locator(`[data-region="${region}"]`).boundingBox())?.height ?? 0;

test('phase 2: panels collapse, resize by mouse and keyboard, and keep their layout', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByRole('banner')).toContainText('Rallly');

  await test.step('The rail’s Entry points closes and reopens the left panel', async () => {
    const tool = page.getByRole('button', { name: 'Entry points' });
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await tool.click();
    await expect.poll(() => width(page, 'left-panel')).toBe(0);
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    // Collapsed means out of reach for the keyboard and screen readers too.
    await expect(page.locator('[data-region="left-panel"]')).toHaveAttribute('inert', '');
    expect(await width(page, 'canvas')).toBe(1440 - 44 - 360);
    await tool.click();
    await expect.poll(() => width(page, 'left-panel')).toBe(248);
  });

  await test.step('The keyboard resizes a panel from its separator', async () => {
    await page.getByRole('separator', { name: 'Resize the left panel' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => width(page, 'left-panel')).toBeGreaterThan(248);
  });

  await test.step('Dragging resizes it too', async () => {
    const box = await page.getByRole('separator', { name: 'Resize the left panel' }).boundingBox();
    if (box === null) throw new Error('no separator');
    await page.mouse.move(box.x + box.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(44 + 320, 400, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => width(page, 'left-panel')).toBe(320);
  });

  await test.step('The right panel toggles from the top bar', async () => {
    const toggle = page.getByRole('button', { name: 'Right panel' });
    await toggle.click();
    await expect.poll(() => width(page, 'right-panel')).toBe(0);
    await toggle.click();
    await expect.poll(() => width(page, 'right-panel')).toBe(360);
  });

  await test.step('The bottom dock opens, and says why there’s no shell yet', async () => {
    expect(await height(page, 'dock')).toBe(0);
    await page.getByRole('button', { name: 'Terminal' }).click();
    await expect.poll(() => height(page, 'dock')).toBe(300);
    await expect(page.locator('[data-region="dock"]')).toContainText(
      'Open the workspace to use a terminal here.',
    );
  });

  await test.step('Full screen collapses everything but the canvas, and restores it', async () => {
    await page.getByRole('button', { name: 'Full-screen canvas' }).click();
    await expect.poll(() => width(page, 'left-panel')).toBe(0);
    expect(await width(page, 'right-panel')).toBe(0);
    expect(await height(page, 'dock')).toBe(0);
    expect(await width(page, 'canvas')).toBe(1440 - 44);
    await page.getByRole('button', { name: 'Leave full screen' }).click();
    await expect.poll(() => width(page, 'left-panel')).toBe(320);
    expect(await width(page, 'right-panel')).toBe(360);
    expect(await height(page, 'dock')).toBe(300);
  });

  await test.step('The review bar opens to 300 px', async () => {
    await page.getByRole('button', { name: 'Show review' }).click();
    await expect.poll(() => height(page, 'review-bar')).toBe(300);
    await expect(page.locator('[data-region="review-bar"]')).toContainText(
      'Changes from an agent session',
    );
    await page.getByRole('button', { name: 'Hide review' }).click();
    await expect.poll(() => height(page, 'review-bar')).toBe(40);
  });

  await test.step('A reload keeps the layout (per browser)', async () => {
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('Rallly');
    await expect.poll(() => width(page, 'left-panel')).toBe(320);
  });

  expect(watch.problems()).toEqual([]);
});
