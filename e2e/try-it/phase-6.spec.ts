import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 6 · Try it: Labs → Graph stats shows node and edge counts for each demo fork. In a real browser under the
// production CSP: the switch turned on in the Labs panel, the project opened, and its graph read in the inspector's
// Details tab while it's built and once it's ready. The workspace is a fake answering as the engine does, with
// Rallly's counts from the engine itself (ADR 0027 addendum); the engine's graphs of the four forks are proven in real
// workspaces by the Docker corpus test (workspace/host/src/corpus.docker.test.ts).

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c6', '2026-11-12T09:00:00.000Z');

const READY = {
  state: 'ready',
  message: null,
  snapshot: {
    version: 'a'.repeat(64),
    takenAt: '2026-11-12T10:42:00.000Z',
    complete: true,
    note: null,
    files: 1168,
    builtInCalls: 3930,
    stats: {
      nodes: 3327,
      edges: 16394,
      byNodeKind: {
        'entry-point': 0,
        'code-unit': 3327,
        decision: 0,
        'data-access': 0,
        'async-handoff': 0,
        'external-boundary': 0,
      },
      byCodeUnit: { function: 1603, method: 189, component: 1081, class: 38, module: 416 },
      byEdgeKind: { call: 16394, branch: 0, data: 0, handoff: 0, boundary: 0 },
      byProvenance: { observed: 0, resolved: 7514, convention: 0, suggested: 0, unknown: 8880 },
    },
    buildMs: 4100,
    saveMs: 20,
    loadMs: 10,
  },
};

/** A fake workspace whose graph is being built for one answer, then ready; it counts how often it's asked. */
function fakeWorkspace(page: Page) {
  const graph = { buildingAnswers: 1, asked: 0 };
  new FakeWorkspace(page, {
    project: PROJECT,
    answers: {
      '/api/usage': () => ({
        usage: {
          periodStart: '2026-11-01T00:00:00.000Z',
          resetsAt: '2026-12-01T00:00:00.000Z',
          workspaceSeconds: 0,
          storageByteHours: 0,
        },
      }),
      '/workspace/index/graph': () => {
        graph.asked += 1;
        if (graph.buildingAnswers > 0) {
          graph.buildingAnswers -= 1;
          return { state: 'building', message: null, snapshot: null };
        }
        return READY;
      },
    },
  });
  return graph;
}

test('phase 6: Labs → Graph stats shows the graph’s node and edge counts', async ({ page }) => {
  const watch = watchForPageProblems(page);
  const graph = fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step('Turn on Graph stats in Labs: off until then, and the graph isn’t asked for', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Labs' }).click();
    const labs = page.getByRole('dialog', { name: 'Labs' });
    const graphStats = labs.getByRole('switch', { name: /Graph stats/ });
    await expect(graphStats).not.toBeChecked();
    await expect(labs).toContainText('Finished in phase 7.');
    await graphStats.click();
    await expect(graphStats).toBeChecked();
    await page.keyboard.press('Escape');
    expect(graph.asked).toBe(0);
  });

  await test.step('Open the project: the Details tab says the graph is being built', async () => {
    await page.goto(`/p/${PROJECT.id}`);
    await expect(page.getByRole('tab', { name: 'Details', selected: true })).toBeVisible();
    const stats = page.getByRole('region', { name: 'Graph stats' });
    await expect(stats.getByRole('status')).toHaveText('Building the graph…');
    await expect(stats).toContainText('Labs · preview');
  });

  await test.step('Once it’s built: node and edge counts, every kind listed, how edges are known', async () => {
    const stats = page.getByRole('region', { name: 'Graph stats' });
    await expect(stats.getByText('3,327 nodes · 16,394 edges')).toBeVisible();
    const nodes = stats.getByRole('region', { name: 'Nodes' });
    await expect(nodes).toContainText('Code units');
    await expect(nodes).toContainText('Entry points arrives in phase 8');
    const known = stats.getByRole('region', { name: 'How edges are known' });
    await expect(known).toContainText('Resolved proven by the compiler');
    await expect(known).toContainText('7,514');
    await expect(known).toContainText('8,880');
    await expect(stats).toContainText(
      '3,930 calls into TypeScript’s library, counted, not in the graph.',
    );
    await expect(stats).toContainText('Built in 4.1 s · saved in 20 ms · loaded in 10 ms');
  });

  expect(watch.problems()).toEqual([]);
});
