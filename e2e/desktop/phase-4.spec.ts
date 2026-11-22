// Phase 4 of build plan v2 (the engine on local projects), in the real Electron app on copies of the forks at their pins.
// Done when: Rallly, Documenso and Twenty analyse locally; a saved edit is reflected in under 3 s.
// - "Analyse locally": the app's own engine builds each fork's graph on this machine, and its entry points meet the
//   corpus bar the Docker workspaces were held to (phase 8, owner 14 Nov 2026), asked for through the app's API.
// - "Reflected in under 3 s": ten saved edits to Twenty, each a new API route, timed from the save on disk to the route
//   in the Entry points panel; the 90th percentile under 3 s, and each one shows "Analysing…" before it's current.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { accessibilityProblems } from '../accessibility.js';
import {
  barProblems,
  compareEntryPoints,
  type AnsweredEntryPoint,
  type ForkLabels,
} from '../../corpus/src/entry-points.js';
import { cloneFork, launchApp } from './support.js';

// Twenty's first analysis takes about 2½ minutes on the laptop; CI's machines are slower.
const ANALYSE_MS = Number(process.env.FLOWCANVAS_E2E_ANALYSE_MS ?? 20 * 60_000);
const REFLECTED_MS = 3000;
const EDITS = 10;
const KINDS = ['screen', 'element', 'api-route', 'job', 'cron', 'event', 'cli-command'] as const;
const labels = JSON.parse(
  readFileSync(new URL('../../corpus/labels/entry-points.json', import.meta.url), 'utf8'),
) as Record<string, ForkLabels | undefined>;

let base: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fc-desktop-engine-'));
});
test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(base, { recursive: true, force: true });
});

interface Status {
  readonly state: string;
  readonly analysing: boolean;
  readonly listed: number;
}

/** A GET of the app's own API, from the page (its cookie and origin). */
const api = <T>(page: Page, path: string): Promise<T> =>
  page.evaluate(async (url) => {
    const response = await fetch(url);
    return (await response.json()) as T;
  }, path);

async function open(fork: string): Promise<{ page: Page; folder: string; base: string }> {
  const folder = cloneFork(fork, base);
  const launched = await launchApp(base, [folder]);
  app = launched.app;
  await expect(launched.page.getByText(fork, { exact: true })).toBeVisible();
  return { page: launched.page, folder, base: indexBase(launched.page) };
}

const indexBase = (page: Page) =>
  `/api/projects/${new URL(page.url()).pathname.split('/').at(-1) ?? ''}/workspace/index`;

/** Waits until the engine has indexed the folder and analysed it whole, with nothing behind. */
async function analysed(page: Page, index: string): Promise<number> {
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const status = await api<Status>(page, `${index}/status`);
        return status.state === 'ready' && !status.analysing;
      },
      { timeout: ANALYSE_MS, intervals: [2000] },
    )
    .toBe(true);
  return Date.now() - started;
}

/** Every entry point the app lists, a page at a time, as the panel asks for them. */
async function allEntryPoints(page: Page, index: string): Promise<AnsweredEntryPoint[]> {
  const found: AnsweredEntryPoint[] = [];
  for (const kind of KINDS) {
    for (let after: number | null = 0; after !== null;) {
      const answer: { entries: AnsweredEntryPoint[]; next: number | null; current: boolean } =
        await api(page, `${index}/entry-points?kind=${kind}&after=${String(after)}&limit=200`);
      expect(answer.current).toBe(true);
      found.push(...answer.entries);
      after = answer.next;
    }
  }
  return found;
}

async function meetsTheBar(page: Page, index: string, fork: string): Promise<void> {
  const graph = await api<{
    state: string;
    message: string | null;
    snapshot: { complete: boolean; buildMs: number; stats: { nodes: number } } | null;
  }>(page, `${index}/graph`);
  expect(graph.state, graph.message ?? '').toBe('ready');
  expect(graph.snapshot?.complete).toBe(true);
  const listed = await allEntryPoints(page, index);
  const forkLabels = labels[fork];
  if (forkLabels === undefined) throw new Error(`No entry point labels for ${fork}`);
  const result = compareEntryPoints(forkLabels, listed);
  expect(barProblems(result)).toEqual([]);
  console.log(
    `desktop: ${fork} analysed locally: ${String(graph.snapshot?.stats.nodes)} nodes in ${String(graph.snapshot?.buildMs)} ms, ${String(listed.length)} entry points`,
  );
}

for (const fork of ['rallly', 'documenso'] as const) {
  test(`phase 4 · Done when: ${fork} analyses locally`, async () => {
    test.setTimeout(ANALYSE_MS + 120_000);
    const { page, base: index } = await open(fork);
    await analysed(page, index);
    await meetsTheBar(page, index, fork);
    // Nothing behind: the chip says nothing.
    await expect(page.getByTestId('index-chip')).toHaveCount(0);
  });
}

// A route added to Twenty's health controller (NestJS): each edit adds one more, so each is a new entry point.
const CONTROLLER =
  'packages/twenty-server/src/engine/core-modules/health/controllers/health.controller.ts';
const withRoutes = (original: string, count: number) =>
  original.replace(
    '  @Get()',
    Array.from(
      { length: count },
      (_, i) =>
        `  @Get('fc-probe-${String(i)}')\n  fcProbe${String(i)}() {\n    return ${String(i)};\n  }\n\n`,
    ).join('') + '  @Get()',
  );

test('phase 4 · Try it: Twenty analyses locally, and a saved edit shows in its entry points within 3 s', async () => {
  test.setTimeout(ANALYSE_MS + 10 * 60_000);
  const { page, folder, base: index } = await open('twenty');
  const file = join(folder, CONTROLLER);
  const original = readFileSync(file, 'utf8');
  expect(original).toContain('  @Get()');

  await test.step('Wait for analysis: the whole graph, its entry points meeting the bar', async () => {
    const ms = await analysed(page, index);
    console.log(`desktop: Twenty analysed in ${String(Math.round(ms / 1000))} s from opening`);
    await meetsTheBar(page, index, 'twenty');
  });

  const filter = page.getByRole('textbox', { name: 'Filter entry points' });
  const panel = page.getByRole('region', { name: 'Entry points' });
  const times: number[] = [];
  await test.step(`Edit a file ${String(EDITS)} times: each new route is listed within 3 s`, async () => {
    for (let i = 0; i < EDITS; i += 1) {
      const name = `fc-probe-${String(i)}`;
      await filter.fill(name);
      await expect(panel.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
      writeFileSync(file, withRoutes(original, i + 1));
      const saved = Date.now();
      // Behind the edit until it's analysed: said so, never shown as up to date.
      await expect(page.getByTestId('index-chip').first()).toHaveText('Analysing…', {
        timeout: 2000,
      });
      await expect(panel.getByRole('row', { name: new RegExp(name) })).toBeVisible({
        timeout: 60_000,
      });
      times.push(Date.now() - saved);
      // Each edit is its own step (an agent's or a save), not a burst: the next waits for this one to settle.
      await analysed(page, index);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1] ?? Infinity;
    console.log(
      `desktop: Twenty, save to entry point (ms): ${times.join(', ')}; p90 ${String(p90)}`,
    );
    expect(p90).toBeLessThan(REFLECTED_MS);
  });

  await test.step('Undo the edits: the routes go again', async () => {
    writeFileSync(file, original);
    await filter.fill('fc-probe');
    await expect(panel.getByRole('row', { name: /fc-probe/ })).toHaveCount(0, { timeout: 60_000 });
    await analysed(page, index);
    await filter.fill('');
    expect(await accessibilityProblems(page, { electron: true })).toEqual([]);
  });
});
