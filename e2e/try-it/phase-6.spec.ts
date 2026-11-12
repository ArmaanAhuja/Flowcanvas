import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 6 · Try it: Labs → Graph stats shows node and edge counts for each demo fork. In a real browser under the
// production CSP: the switch turned on in the Labs panel, the project opened, and its graph read in the inspector's
// Details tab while it's built and once it's ready. The workspace is a fake answering as the engine does, with
// Rallly's counts from the engine itself (ADR 0027 addendum); the engine's graphs of the four forks are proven in real
// workspaces by the Docker corpus test (workspace/host/src/corpus.docker.test.ts).

const PROJECT = {
  id: '3f1c0d2e-0000-4000-8000-0000000000c6',
  name: 'Rallly',
  repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  repoCommit: null,
  createdAt: '2026-11-12T09:00:00.000Z',
  workspace: {
    id: 'w-6',
    state: 'running',
    stateChangedAt: '2026-11-12T09:00:00.000Z',
    failure: null,
  },
};

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

class FakeWorkspace {
  /** The graph is being built for this many answers, then ready. */
  buildingAnswers = 1;
  graphAsked = 0;

  constructor(page: Page) {
    void page.context().route('**/api/**', (route) => this.answer(route));
    void page.context().routeWebSocket(/\/workspace\/events$/, () => undefined);
  }

  private reply(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private answer(route: Route) {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      return this.reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'member' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (url.pathname === '/api/projects')
      return this.reply(route, { projects: [PROJECT], workspacesAvailable: true });
    if (url.pathname === '/api/usage') {
      return this.reply(route, {
        usage: {
          periodStart: '2026-11-01T00:00:00.000Z',
          resetsAt: '2026-12-01T00:00:00.000Z',
          workspaceSeconds: 0,
          storageByteHours: 0,
        },
      });
    }
    if (url.pathname.endsWith('/workspace/index/graph')) {
      this.graphAsked += 1;
      if (this.buildingAnswers > 0) {
        this.buildingAnswers -= 1;
        return this.reply(route, { state: 'building', message: null, snapshot: null });
      }
      return this.reply(route, READY);
    }
    if (url.pathname.endsWith('/workspace/index/status')) {
      return this.reply(route, {
        state: 'ready',
        done: 1958,
        total: 1958,
        files: 1958,
        byStatus: { parsed: 1958, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
        symbols: 5874,
        withSyntaxErrors: 0,
        partlyRead: 0,
        lastFullMs: 1015,
        message: null,
      });
    }
    if (url.pathname.endsWith('/workspace/tree'))
      return this.reply(route, { files: [], truncated: false, source: 'git' });
    if (url.pathname.endsWith('/workspace/journal')) return this.reply(route, { entries: [] });
    return this.reply(route, { error: 'not found' }, 404);
  }
}

test('phase 6: Labs → Graph stats shows the graph’s node and edge counts', async ({ page }) => {
  const watch = watchForPageProblems(page);
  const workspace = new FakeWorkspace(page);
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
    expect(workspace.graphAsked).toBe(0);
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
