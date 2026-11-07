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

const viewport = (page: Page) =>
  page.locator('.react-flow__viewport').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
const zoomLabel = (page: Page) => page.getByLabel('Zoom level').textContent();

test('phase 2: the canvas is honest when empty', async ({ page }) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);
  await page.goto(`/p/${PROJECT.id}`);
  const canvas = page.getByRole('main', { name: 'Canvas' });
  await expect(canvas).toContainText('Flows appear here once the project is analysed.');
  await expect(page.getByRole('toolbar', { name: 'Canvas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit (F)' })).toBeDisabled();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  expect(watch.problems()).toEqual([]);
});

test('phase 2 · Try it: pan, zoom and select on the canvas (stress test, 500 example nodes)', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);
  // The Labs switch, as turned on from the Labs panel (stored in this browser).
  await page.addInitScript(() => {
    window.localStorage.setItem('flowcanvas-labs', JSON.stringify({ 'canvas-stress-test': true }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);

  await test.step('500 example nodes, clearly labelled as examples', async () => {
    await expect(page.getByRole('note')).toHaveText(
      'Canvas stress test (Labs): 500 example nodes, not your project’s flows.',
    );
    await expect(page.locator('.react-flow__node')).toHaveCount(500);
  });

  await test.step('The minimap sits bottom-left at Figma 06’s size', async () => {
    const minimap = await page.locator('.react-flow__minimap').boundingBox();
    const canvas = await page.locator('[data-region="canvas"]').boundingBox();
    if (minimap === null || canvas === null) throw new Error('no minimap or canvas');
    expect(minimap.width).toBe(140);
    expect(minimap.height).toBe(84);
    // Figma 06, minimap(): 20 px from the left, 16 px from the bottom.
    expect(minimap.x - canvas.x).toBeCloseTo(20, 0);
    expect(canvas.y + canvas.height - (minimap.y + minimap.height)).toBeCloseTo(16, 0);
  });

  await test.step('Zoom in and out from the toolbar, and with Ctrl + scroll', async () => {
    const start = await zoomLabel(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomLabel(page)).not.toBe(start);
    const zoomed = (await viewport(page)).zoom;
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(async () => (await viewport(page)).zoom).toBeLessThan(zoomed);
    const before = (await viewport(page)).zoom;
    await page.mouse.move(800, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await viewport(page)).zoom).toBeGreaterThan(before);
  });

  await test.step('Scrolling pans without zooming', async () => {
    const before = await viewport(page);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await viewport(page)).y).not.toBe(before.y);
    expect((await viewport(page)).zoom).toBeCloseTo(before.zoom, 5);
  });

  await test.step('The Pan tool (H) drags the view', async () => {
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: 'Pan (H)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const before = await viewport(page);
    await page.mouse.move(900, 450);
    await page.mouse.down();
    await page.mouse.move(700, 350, { steps: 6 });
    await page.mouse.up();
    const after = await viewport(page);
    expect(after.x).toBeCloseTo(before.x - 200, 0);
    expect(after.y).toBeCloseTo(before.y - 100, 0);
  });

  await test.step('Select (V): a click selects a node; a drag selects a box', async () => {
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Fit (F)' }).click();
    await page.waitForTimeout(300);
    const node = page.locator('.react-flow__node').first();
    await node.click();
    await expect(node).toHaveClass(/selected/);
    await expect(node.locator('[data-selected="true"]')).toHaveCount(1);
    // Fit to screen leaves empty space above a wide grid: start just above and left of the first node, on the
    // background (a drag that starts on a node draws no box), and cover a few rows and columns.
    const first = await node.boundingBox();
    if (first === null) throw new Error('no node');
    await page.mouse.move(first.x - 4, first.y - 4);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width * 6, first.y + first.height * 4, { steps: 8 });
    await page.mouse.up();
    expect(await page.locator('.react-flow__node.selected').count()).toBeGreaterThan(1);
  });

  await test.step('F fits the selection', async () => {
    const before = (await viewport(page)).zoom;
    await page.locator('.react-flow__node').nth(250).click();
    await page.keyboard.press('f');
    await expect.poll(async () => (await viewport(page)).zoom).toBeGreaterThan(before);
  });

  await test.step('Space + drag pans in Select mode too', async () => {
    const before = await viewport(page);
    await page.mouse.move(800, 450);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    expect((await viewport(page)).x).toBeCloseTo(before.x - 100, 0);
  });

  expect(watch.problems()).toEqual([]);
});

test('phase 2: the workspace popover in the top bar, and the dock following the workspace', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);
  let state = 'running';
  const now = () => ({
    id: 'w-1',
    state,
    stateChangedAt: '2026-11-07T09:30:00.000Z',
    failure: null,
  });
  await page.route('**/api/projects', (route) =>
    reply(route, { projects: [{ ...PROJECT, workspace: now() }], workspacesAvailable: true }),
  );
  await page.route(`**/api/projects/${PROJECT.id}/workspace/*`, (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (action === 'sleep') state = 'sleeping';
    if (action === 'resume') state = 'running';
    return reply(route, { workspace: now() });
  });
  await page.routeWebSocket(/\/workspace\/terminal/, (socket) => {
    socket.send(Buffer.from('Rallly workspace\r\n$ '));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);

  await test.step('The chip opens the workspace’s facts', async () => {
    await page.getByRole('button', { name: 'Workspace: Running' }).click();
    const popover = page.getByRole('dialog', { name: 'Workspace' });
    await expect(popover).toContainText('2 cores · 4 GiB · this computer');
    await expect(popover).toContainText('Running since');
    await expect(popover).toContainText('This month');
  });

  await test.step('Sleep now: the chip follows, and the dock says there’s no shell while asleep', async () => {
    await page.getByRole('button', { name: 'Sleep now' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Workspace' }).getByRole('button', { name: 'Resume' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Workspace: Sleeping' })).toBeVisible();
    await page.getByRole('button', { name: 'Terminal' }).click();
    await expect(page.locator('[data-region="dock"]')).toContainText(
      'Open the workspace to use a terminal here.',
    );
  });

  await test.step('Resume from the popover: the dock connects a terminal', async () => {
    await page.getByRole('button', { name: 'Workspace: Sleeping' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Workspace: Running' })).toBeVisible();
    await expect(page.locator('[data-region="dock"] .xterm-rows')).toContainText(
      'Rallly workspace',
    );
  });

  expect(watch.problems()).toEqual([]);
});
