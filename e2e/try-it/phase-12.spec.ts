import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 12 · Try it: open Twenty's largest flow; expand a group; read the completeness pill. In a real browser under
// the production CSP, on the engine's own flow for Twenty at its pin (fixtures/phase-12-twenty.json: buildFlow on
// its graph; PartnerProfilePage, the entry point whose flow is largest, 60 nodes and 96 more not shown):
// - it opens as 8 or fewer groups and nodes, the groups named from the code (folders), never a guessed category;
// - opening a group moves no other node on the screen: every one's box is the same before and after (Done when);
// - its members are drawn in its frame; closing it gives the card back;
// - the completeness pill, pressed, makes the weak edges stand out.

const PROJECT = runningProject(
  '3f1c0d2e-0000-4000-8000-0000000000cd',
  '2026-11-16T09:00:00.000Z',
  'Twenty',
);
const PAGE = 'packages/twenty-website/src/app/[locale]/(site)/partners/profile/[slug]/page.tsx';
const ROOT = `${PAGE}#PartnerProfilePage`;
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/phase-12-twenty.json', import.meta.url), 'utf8'),
) as { flows: Record<string, unknown> };

function fakeWorkspace(page: Page) {
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        return {
          symbols: 'partnerprofilepage'.startsWith(query)
            ? [
                {
                  name: 'PartnerProfilePage',
                  path: PAGE,
                  line: 40,
                  column: 31,
                  kind: 'function',
                  container: null,
                  exported: true,
                },
              ]
            : [],
          ms: 1,
        };
      },
      '/workspace/index/flow': (url) => {
        const flow = url.searchParams.get('path') === PAGE ? FIXTURE.flows[ROOT] : undefined;
        return {
          flow: flow ?? null,
          message: flow === undefined ? 'Not in this walkthrough’s fake.' : null,
          version: 'd'.repeat(64),
          takenAt: '2026-11-16T10:00:00.000Z',
          current: true,
          complete: true,
        };
      },
      '/workspace/index/details': () => ({
        details: null,
        message: 'Details aren’t in this fake.',
      }),
    },
  });
}

/** Every node drawn on the canvas, by id, with its box on the screen. */
async function boxes(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => {
        const box = node.getBoundingClientRect();
        return [
          node.dataset.id ?? '',
          { x: box.x, y: box.y, width: box.width, height: box.height },
        ];
      }),
    ),
  );
}

test('phase 12 · Try it: Twenty’s largest flow in 8 or fewer groups; opening one moves nothing else; the completeness pill', async ({
  page,
}) => {
  const watch = watchForPageProblems(page);
  fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Twenty', { exact: true })).toBeVisible();
  const canvas = page.getByRole('main', { name: 'Canvas' });

  await test.step('Open the flow: 8 or fewer groups and nodes, the groups named from the code', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
    await page.keyboard.type('PartnerProfilePage');
    await page.getByRole('option', { name: /^Show the flow from PartnerProfilePage/ }).click();
    await expect(canvas.getByRole('status')).toContainText('edges');
    await page.keyboard.press('f');
    const groups = canvas.locator('.react-flow__node-group');
    const alone = canvas.locator('.react-flow__node-flow, .react-flow__node-decision');
    await expect(groups.first()).toBeVisible();
    // The root aside, at most 8 things to read.
    expect((await groups.count()) + (await alone.count()) - 1).toBeLessThanOrEqual(8);
    await expect(canvas.getByRole('button', { name: 'src/platform, 18 nodes' })).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'src/partners-marketplace, 17 nodes' }),
    ).toBeVisible();
  });

  await test.step('Open a group: every other node keeps its place on the screen; its members are in its frame', async () => {
    const before = await boxes(page);
    const group = 'group:main:dir:packages/twenty-website/src/platform';
    expect(before[group]).toBeDefined();
    const header = canvas.getByRole('button', { name: 'src/platform, 18 nodes' });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.locator('.react-flow__node-flow')).not.toHaveCount(0);
    const after = await boxes(page);
    // The group's own open ends become its members' (drawn in the frame): every other node stays.
    const others = Object.keys(before).filter((id) => id !== group && !id.startsWith(`${group}::`));
    expect(others.length).toBeGreaterThan(5);
    for (const id of others) {
      const was = before[id];
      const now = after[id];
      expect(now, `${id} is still drawn`).toBeDefined();
      if (was === undefined || now === undefined) continue;
      expect(Math.abs(now.x - was.x), `${id} moved across`).toBeLessThanOrEqual(1);
      expect(Math.abs(now.y - was.y), `${id} moved down`).toBeLessThanOrEqual(1);
    }
    // The frame stays where the card was, and grows to hold its members.
    const frame = after[group];
    expect(Math.abs((frame?.x ?? 0) - (before[group]?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(frame?.height ?? 0).toBeGreaterThan((before[group]?.height ?? 0) * 2);
  });

  await test.step('The completeness pill: pressed, the weak edges stand out', async () => {
    const pill = canvas.getByRole('button', { name: /edges/ });
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(await canvas.locator('[data-highlighted]').count()).toBeGreaterThan(0);
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('Close the group: its card comes back; the flow’s open ends are still drawn', async () => {
    const header = canvas.getByRole('button', { name: 'src/platform, 18 nodes' });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.locator('.react-flow__node-stub').first()).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});
