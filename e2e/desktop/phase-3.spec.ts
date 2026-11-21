// Phase 3 of build plan v2 (run the project), in the real Electron app on copies of Rallly and Documenso at their pins.
// Done when: Rallly and Documenso start from one button; a missing variable shows a clear prompt.
// Both install their dependencies from that button (Rallly with pnpm, Documenso with npm) and start their dev
// servers; the server answering on the address its card shows is "started". Rallly needs Node 24 (its engines field),
// given by FLOWCANVAS_E2E_NODE_BIN when the machine's own Node is another one.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { accessibilityProblems } from '../accessibility.js';
import { cloneFork, launchApp } from './support.js';

const NODE_BIN = process.env.FLOWCANVAS_E2E_NODE_BIN;
const INSTALL_MS = Number(process.env.FLOWCANVAS_E2E_INSTALL_MS ?? 10 * 60_000);
// FLOWCANVAS_E2E_START_MS shortens the wait where a server can't start (Rallly's portless asks for sudo off CI).
const START_MS = Number(process.env.FLOWCANVAS_E2E_START_MS ?? 5 * 60_000);
// Set as in the person's shell: both projects' installs would otherwise download Playwright's browsers for their own
// tests (hundreds of MB, nothing to do with starting the app).
const SHELL = { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' };

let base: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fc-desktop-run-'));
});
test.afterEach(async () => {
  // Closing the app stops every process it started.
  await app?.close();
  app = undefined;
  rmSync(base, { recursive: true, force: true });
});

/** The dock's Run panel. */
const runPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Run' });

/** Waits for the card's address, then for the server to answer there (a dev server compiles on its first request). */
async function answers(page: Page, card: string): Promise<number> {
  const region = runPanel(page).getByRole('region', { name: card }).first();
  const address = region.getByRole('link', { name: /^localhost:\d+$/ }).first();
  await expect(address).toBeVisible({ timeout: START_MS });
  const port = Number((await address.textContent())?.split(':')[1]);
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(`http://localhost:${String(port)}/`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(60_000),
          });
          return response.status;
        } catch {
          return 0;
        }
      },
      { timeout: START_MS, intervals: [2000] },
    )
    .toBeGreaterThan(0);
  return port;
}

/** Waits until a card has ended, and says how. */
async function ended(page: Page, card: string, timeout: number): Promise<string | null> {
  const region = runPanel(page).getByRole('region', { name: card }).first();
  await expect(region).toHaveAttribute('data-state', /^(finished|failed|stopped)$/, { timeout });
  return region.getAttribute('data-state');
}

test('phase 3 · Try it: Rallly asks for its secret, then starts from one button', async () => {
  test.setTimeout(INSTALL_MS + 2 * START_MS);
  const folder = cloneFork('rallly', base);
  const launched = await launchApp(
    base,
    [folder],
    NODE_BIN === undefined ? {} : { path: [NODE_BIN] },
  );
  app = launched.app;
  const { page } = launched;
  await expect(page.getByText('rallly', { exact: true })).toBeVisible();
  const run = page.getByRole('button', { name: 'Run', exact: true });

  await test.step('Run asks first for the variable Rallly’s example says is required', async () => {
    await run.click();
    const needed = runPanel(page).getByRole('group', { name: 'Needed before it runs' });
    await expect(needed.getByLabel('SECRET_PASSWORD')).toBeVisible();
    await expect(needed.getByText('apps/web/.env.sample').first()).toBeVisible();
    await expect(runPanel(page).getByText('apps/web/.env doesn’t exist yet.')).toBeVisible();
    // Nothing started: it waits for the variable.
    await expect(runPanel(page).getByText('Nothing has run yet.')).toBeVisible();
    expect(await accessibilityProblems(page, { electron: true })).toEqual([]);
  });

  await test.step('The .env starts from its example; a generated secret goes into it, never onto the page', async () => {
    await runPanel(page)
      .getByRole('button', { name: 'Create apps/web/.env from .env.sample' })
      .click();
    await expect(runPanel(page).getByText('apps/web/.env doesn’t exist yet.')).toBeHidden();
    const needed = runPanel(page).getByRole('group', { name: 'Needed before it runs' });
    await needed.getByRole('button', { name: 'Generate' }).click();
    await needed.getByRole('button', { name: 'Save' }).click();
    await expect(needed).toBeHidden();
    const env = readFileSync(join(folder, 'apps/web/.env'), 'utf8');
    const secret = /^SECRET_PASSWORD=([0-9a-f]{64})$/m.exec(env)?.[1];
    expect(secret).toBeDefined();
    expect(await page.locator('body').innerText()).not.toContain(secret);
  });

  await test.step('Run installs the dependencies, then starts dev, which needs Rallly’s proxy first', async () => {
    await run.click();
    expect(await ended(page, 'Install dependencies', INSTALL_MS)).toBe('finished');
    expect(await ended(page, 'dev', START_MS)).toBe('failed');
  });

  await test.step('Rallly’s own proxy starts from its script (it asks for sudo: none needed on CI)', async () => {
    // At this pin Rallly's dev script runs behind portless, a local HTTPS proxy started once with sudo; dev fails
    // until it runs. A card is a terminal, so its sudo prompt can be answered there by the person.
    await runPanel(page).getByRole('button', { name: 'Run a script' }).click();
    // Enter on the item itself: the menu re-renders as cards update, and a click can land on its neighbour.
    await page.getByRole('menuitem', { name: /^proxy:start/ }).press('Enter');
    expect(await ended(page, 'proxy:start', START_MS)).toBe('finished');
  });

  await test.step('Run starts the dev server, which answers', async () => {
    await run.click();
    const port = await answers(page, 'dev');
    // The top bar shows where it runs, and Stop.
    await expect(
      page.getByRole('link', { name: `localhost:${String(port)}` }).first(),
    ).toBeVisible();
    console.log(`desktop: Rallly's dev server answered on localhost:${String(port)}`);
  });

  await test.step('Stop stops it', async () => {
    await page.getByRole('button', { name: 'Stop' }).first().click();
    expect(await ended(page, 'dev', 30_000)).toBe('stopped');
    expect(await accessibilityProblems(page, { electron: true })).toEqual([]);
  });
});

test('phase 3 · Try it: Documenso starts from one button, its services in Docker', async () => {
  test.setTimeout(INSTALL_MS + 3 * START_MS);
  const folder = cloneFork('documenso', base);
  const launched = await launchApp(base, [folder], { env: SHELL });
  app = launched.app;
  const { page } = launched;
  await expect(page.getByText('documenso', { exact: true })).toBeVisible();

  await test.step('A missing .env is offered from its example', async () => {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(
      runPanel(page).getByText('.env doesn’t exist yet.', { exact: true }),
    ).toBeVisible();
    await runPanel(page).getByRole('button', { name: 'Create .env from .env.example' }).click();
    await expect(runPanel(page).getByText('.env doesn’t exist yet.', { exact: true })).toBeHidden();
    expect(readFileSync(join(folder, '.env'), 'utf8')).toContain('NEXT_PUBLIC_WEBAPP_URL=');
  });

  await test.step('Its services start in Docker from their compose file', async () => {
    await runPanel(page).getByRole('button', { name: 'Start services' }).click();
    expect(await ended(page, 'Start services', START_MS)).toBe('finished');
  });

  await test.step('Run installs the dependencies, then starts the dev server, which answers', async () => {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    expect(await ended(page, 'Install dependencies', INSTALL_MS)).toBe('finished');
    const port = await answers(page, 'dev');
    console.log(`desktop: Documenso's dev server answered on localhost:${String(port)}`);
    await page.getByRole('button', { name: 'Stop' }).first().click();
    expect(await ended(page, 'dev', 30_000)).toBe('stopped');
  });

  await test.step('Its services stop too (they’d keep running in Docker otherwise)', async () => {
    await runPanel(page).getByRole('button', { name: 'Stop services' }).click();
    expect(await ended(page, 'Stop services', START_MS)).toBe('finished');
    expect(await accessibilityProblems(page, { electron: true })).toEqual([]);
  });
});
