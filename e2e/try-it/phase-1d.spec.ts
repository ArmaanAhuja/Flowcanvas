import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 1d · Try it: open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume.
//
// Workspaces run on the owner's laptop for now (ADR 0016), so a deployed copy can't open one. This walkthrough
// drives the real page with the API and the terminal's WebSocket answered inside the test, and proves the
// terminal works under the deployed Content-Security-Policy: no violations, and xterm.js's styles applied.
// The real shell is proven by the Docker tests (workspace host and the Worker relay in workerd).
// Steps 9 and 10 extend this with opening, sleeping and resuming.

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000d1',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  createdAt: '2026-11-04T09:00:00.000Z',
  workspace: { id: 'w-1', state: 'running' },
};

async function fakeApi(page: Page): Promise<void> {
  const reply = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      return reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (path === '/api/projects') return reply(route, { projects: [PROJECT] });
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
    await expect(page.getByText('Workspace running')).toBeVisible();
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
    // Narrower than the version page's column (about 400 px until the phase 2 app shell), so the
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
