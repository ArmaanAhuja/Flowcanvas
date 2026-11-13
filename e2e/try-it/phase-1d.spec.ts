import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 1d · Try it: open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume.
//
// Workspaces run on the owner's laptop for now (ADR 0016), so a deployed copy can't open one. This walkthrough
// drives the real page with the API and the terminal's WebSocket answered inside the test, and proves the
// terminal works under the deployed Content-Security-Policy: no violations, and xterm.js's styles applied.
// The real shell is proven by the Docker tests (workspace host and the Worker relay in workerd), and so are
// the real clone, idle sleep and resume. Here: what the page shows and sends at each step (step 9).

const CHANGED_AT = '2026-11-05T09:30:00.000Z';
const workspace = (state: string, failure: string | null = null) => ({
  id: 'w-1',
  state,
  stateChangedAt: CHANGED_AT,
  failure,
});

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000d1',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: null,
  createdAt: '2026-11-04T09:00:00.000Z',
  workspace: workspace('running'),
};

const DEMO = {
  id: '3f1c0d2e-0000-4000-8000-0000000000de',
  name: 'Rallly (demo)',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
  createdAt: '2026-11-05T09:00:00.000Z',
  workspace: workspace('not_created'),
};

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeApi(
  page: Page,
  options: { projects?: unknown[]; available?: boolean } = {},
): Promise<void> {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      return reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (path === '/api/projects') {
      return reply(route, {
        projects: options.projects ?? [PROJECT],
        workspacesAvailable: options.available ?? true,
      });
    }
    if (path === '/api/usage') {
      return reply(route, {
        periodStart: '2026-11-01T00:00:00.000Z',
        resetsAt: '2026-12-01T00:00:00.000Z',
        workspaceSeconds: 0,
        storageByteHours: 0,
      });
    }
    return reply(route, { error: 'not found' }, 404);
  });
}

test('phase 1d: a terminal in the workspace, under the deployed CSP', async ({ page }) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page);
  const typed: string[] = [];
  const controls: unknown[] = [];
  let url = '';

  // The workspace's side of the terminal: a tiny shell that answers `echo`.
  await page.routeWebSocket(/\/api\/projects\/[^/]+\/workspace\/terminal/, (socket) => {
    url = socket.url();
    socket.send(Buffer.from('Rallly workspace\r\n$ '));
    let line = '';
    socket.onMessage((message) => {
      if (typeof message === 'string') {
        controls.push(JSON.parse(message));
        return;
      }
      const text = message.toString();
      typed.push(text);
      // Echo as a terminal would, then answer when Enter comes.
      socket.send(Buffer.from(text.replace('\r', '\r\n')));
      line += text;
      if (!line.includes('\r')) return;
      const command = line.split('\r')[0] ?? '';
      line = '';
      if (command === 'exit') {
        socket.send(JSON.stringify({ type: 'exit', code: 0 }));
        void socket.close();
        return;
      }
      const echoed = /^echo (.*)$/.exec(command)?.[1];
      socket.send(Buffer.from(`${echoed ?? `${command}: not in this test`}\r\n$ `));
    });
  });

  await test.step('The running project offers a terminal', async () => {
    await page.goto('/');
    await expect(page.getByText('Running · 2 cores')).toBeVisible();
    await page.getByRole('button', { name: 'Terminal' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Connected to the workspace.' }),
    ).toBeVisible();
    await expect(page.locator('.xterm-rows')).toContainText('Rallly workspace');
    expect(url).toMatch(
      /\/api\/projects\/3f1c0d2e-0000-4000-8000-0000000000d1\/workspace\/terminal\?cols=\d+&rows=\d+$/,
    );
  });

  await test.step('Run a command in the terminal', async () => {
    await page.getByLabel('Terminal for Rallly').click();
    await page.keyboard.type('echo hello from the walkthrough');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('hello from the walkthrough');
    // Typing went as bytes (binary frames), one key at a time.
    expect(typed.join('')).toBe('echo hello from the walkthrough\r');
  });

  await test.step('xterm.js is styled, and the CSP blocked nothing', async () => {
    // From xterm's own injected rule (`.xterm-rows span { display: inline-block }`), applied through a
    // constructed stylesheet; without it a span would be `inline`.
    const display = await page
      .locator('.xterm-rows span')
      .first()
      .evaluate((span) => getComputedStyle(span).display);
    expect(display).toBe('inline-block');
    expect(await page.locator('.xterm style').count()).toBe(0);
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBeGreaterThan(0);
  });

  await test.step('A size change is sent as a resize message', async () => {
    // Narrower than the projects list's column (about 400 px), so the
    // terminal itself gets narrower.
    await page.setViewportSize({ width: 360, height: 720 });
    await expect.poll(() => controls.length).toBeGreaterThan(0);
    expect(controls.at(-1)).toMatchObject({ type: 'resize' });
  });

  await test.step('Exiting ends the terminal, and a new one can be started', async () => {
    await page.getByLabel('Terminal for Rallly').click();
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await expect(page.getByText('The terminal ended (exit code 0).')).toBeVisible();
    await page.getByRole('button', { name: 'Start a new terminal' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('Rallly workspace');
  });

  expect(watch.problems()).toEqual([]);
});

test('phase 1d: open the demo project in one click, put it to sleep, then resume', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  // The demo's workspace, as the control plane would move it (the real moves are the Docker tests').
  let state = workspace('not_created');
  const actions: string[] = [];
  await fakeApi(page, { projects: [] });
  await page.route('**/api/projects/demo', (route) =>
    reply(route, { project: { ...DEMO, workspace: state } }, 201),
  );
  await page.route(`**/api/projects/${DEMO.id}/workspace/*`, async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    actions.push(action);
    if (action === 'open') {
      // Long enough to see the starting card, as a real clone would be.
      await new Promise((resolve) => setTimeout(resolve, 600));
      state = workspace('running');
    }
    if (action === 'sleep') state = workspace('sleeping');
    if (action === 'resume') state = workspace('running');
    return reply(route, { workspace: state });
  });

  await test.step('Open demo project: listed first, pinned to the corpus commit, and starting', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open demo project' }).click();
    const card = page.getByRole('region', { name: 'Rallly (demo) workspace starting' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(
      'Cloning github.com/ArmaanAhuja-7777/rallly at 8e67a21. Usually under 15 seconds.',
    );
    await expect(page.getByText('Starting…')).toBeVisible();
    await expect(
      page.getByText('https://github.com/ArmaanAhuja-7777/rallly · pinned at 8e67a21'),
    ).toBeVisible();
  });

  await test.step('It comes up running, with a terminal', async () => {
    await expect(page.getByText('Running · 2 cores')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terminal' })).toBeVisible();
    expect(actions).toEqual(['open']);
  });

  await test.step('Sleep: the asleep card, with real facts only', async () => {
    await page.getByRole('button', { name: 'Sleep' }).click();
    const card = page.getByRole('region', { name: 'Rallly (demo) workspace asleep' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('This workspace is asleep');
    await expect(card).toContainText('2 cores · 4 GiB · this computer');
    // Asked for by the person: nothing says it was idle, and nothing claims a backup.
    await expect(card).not.toContainText(/idle|backup|checkpoint/i);
    await expect(page.getByRole('button', { name: 'Terminal' })).toBeHidden();
  });

  await test.step('Resume: running again', async () => {
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Running · 2 cores')).toBeVisible();
    expect(actions).toEqual(['open', 'sleep', 'resume']);
  });

  expect(watch.problems()).toEqual([]);
});

test('phase 1d: where workspaces can’t run (staging), the page says so and offers nothing that can’t work', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  await fakeApi(page, {
    projects: [{ ...PROJECT, workspace: workspace('not_created') }],
    available: false,
  });
  await page.goto('/');
  await expect(
    page.getByText(
      'Workspaces run on your own computer until a cloud provider is connected (phase 1d). Open your projects there with pnpm dev.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Rallly', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open demo project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  expect(watch.problems()).toEqual([]);
});

test('phase 1d · Try it: open Rallly from its GitHub URL, run a command, wait for sleep, then resume', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  // The page's clock is the test's: the 30 s check for a sleep happens when the test says so.
  await page.clock.install();
  const project = {
    ...PROJECT,
    id: '3f1c0d2e-0000-4000-8000-0000000000aa',
    workspace: workspace('not_created'),
  };
  let state = workspace('not_created');
  let created = false;
  await fakeApi(page, { projects: [] });
  await page.route('**/api/projects', (route) => {
    if (route.request().method() !== 'POST') {
      return reply(route, {
        projects: created ? [{ ...project, workspace: state }] : [],
        workspacesAvailable: true,
      });
    }
    created = true;
    return reply(route, { project: { ...project, workspace: state } }, 201);
  });
  await page.route(`**/api/projects/${project.id}/workspace`, (route) =>
    reply(route, { workspace: state, available: true }),
  );
  await page.route(`**/api/projects/${project.id}/workspace/*`, (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (action === 'open' || action === 'resume') state = workspace('running');
    return reply(route, { workspace: state });
  });
  let typed = '';
  await page.routeWebSocket(/\/workspace\/terminal/, (socket) => {
    socket.send(Buffer.from('$ '));
    socket.onMessage((message) => {
      if (typeof message === 'string') return;
      const text = message.toString();
      typed += text;
      socket.send(Buffer.from(text.replace('\r', '\r\n')));
      if (typed.endsWith('\r')) socket.send(Buffer.from('8e67a21 Pinned commit\r\n$ '));
    });
  });

  await test.step('Create Rallly from its GitHub address and open it', async () => {
    await page.goto('/');
    await page.getByLabel('Project name').fill('Rallly');
    await page.getByLabel('Repository address (optional)').fill(PROJECT.repoUrl);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('Running · 2 cores')).toBeVisible();
  });

  await test.step('Run a command in the terminal', async () => {
    await page.getByRole('button', { name: 'Terminal' }).click();
    await page.getByLabel('Terminal for Rallly').click();
    await page.keyboard.type('git log --oneline -1');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('8e67a21 Pinned commit');
  });

  await test.step('Wait for sleep: the page notices the idle sleep by itself', async () => {
    // The control plane's minute check puts it to sleep after 10 idle minutes (proven for real by
    // pnpm test:idle-real); the page sees it at its next check, within 30 s, without a reload.
    state = workspace('sleeping', 'Put to sleep after 10 minutes without activity.');
    await page.clock.runFor(31_000);
    const card = page.getByRole('region', { name: 'Rallly workspace asleep' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Put to sleep after 10 minutes without activity.');
    await expect(page.getByRole('button', { name: 'Terminal' })).toBeHidden();
  });

  await test.step('Resume: running again', async () => {
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Running · 2 cores')).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});
