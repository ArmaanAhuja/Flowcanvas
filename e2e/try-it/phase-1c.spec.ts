import { expect, test, type Page, type Route } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 1c · Try it: sign in with GitHub, create a project, add a secret, confirm the logs show no value.
//
// Signing in needs a real GitHub or Google account and only works on staging, so it can't run unattended here.
// The walkthrough is in two parts:
// 1. Against the real deployed API: signed out, the page offers sign-in (or says where it works), and every
//    signed-in route refuses with 401.
// 2. The signed-in steps in the real page, with the API answered by a fake inside this test, to record the
//    flow and prove the page never shows a saved value. That the API and its logs never contain one is proven by
//    services/control-plane/src/api/no-leaks.test.ts; the real sign-in is the owner's manual check (phase report).

test('phase 1c: signed out, sign-in is offered and the API refuses', async ({ page, request }) => {
  const watch = watchForPageProblems(page);

  await test.step('Open the link: the account row offers sign-in, or says where it works', async () => {
    await page.goto('/');
    await expect(
      page
        .getByRole('link', { name: 'Sign in with GitHub' })
        .or(page.getByText('Sign-in works on'))
        .or(page.getByText('Sign-in is unavailable'))
        .or(page.getByText('Sign-in isn’t set up')),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeHidden();
  });

  await test.step('Without a session, every signed-in route answers 401', async () => {
    const health = await request.get('/api/health');
    const hasApi = (health.headers()['content-type'] ?? '').includes('application/json');
    // `vite preview` (local runs) serves the page without the API; deployed copies have both.
    test.skip(!hasApi, 'No API on this copy (local vite preview)');
    for (const path of ['/api/projects', '/api/usage', '/api/admin', '/api/projects/x/secrets']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()['cache-control'], path).toBe('no-store');
    }
  });

  expect(watch.problems()).toEqual([]);
});

const SECRET_VALUE = 'CANARY-walkthrough-value';

/** A small in-memory API for one signed-in admin, recording every response it sends. */
async function fakeApi(page: Page): Promise<{ responses: string[] }> {
  const responses: string[] = [];
  const projects: object[] = [];
  const secrets: { name: string; addedBy: string; createdAt: string; updatedAt: string }[] = [];
  const now = '2026-10-31T09:00:00.000Z';
  const reply = (route: Route, body: unknown, status = 200) => {
    const text = body === null ? '' : JSON.stringify(body);
    responses.push(text);
    return route.fulfill({ status, contentType: 'application/json', body: text });
  };

  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/me') {
      return reply(route, {
        user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'admin' },
        signIn: 'available',
        providers: ['github'],
      });
    }
    if (path === '/api/projects' && method === 'POST') {
      const { name } = request.postDataJSON() as { name: string };
      const project = {
        id: '3f1c0d2e-0000-4000-8000-000000000001',
        name,
        repoUrl: null,
        createdAt: now,
        workspace: { id: 'w-1', state: 'not_created' },
      };
      projects.unshift(project);
      return reply(route, { project }, 201);
    }
    if (path === '/api/projects') return reply(route, { projects });
    if (path.endsWith('/secrets')) return reply(route, { secrets });
    if (path.includes('/secrets/') && method === 'PUT') {
      const name = path.split('/').pop() ?? '';
      secrets.push({ name, addedBy: 'Ada', createdAt: now, updatedAt: now });
      // Like the real API: the answer names the secret and never contains its value.
      return reply(route, { name, result: 'created' }, 201);
    }
    if (path === '/api/usage') {
      return reply(route, {
        usage: {
          periodStart: '2026-10-01T00:00:00.000Z',
          resetsAt: '2026-11-01T00:00:00.000Z',
          workspaceSeconds: 0,
          storageByteHours: 0,
        },
      });
    }
    if (path === '/api/admin') {
      return reply(route, {
        people: [],
        allowlist: [{ email: 'ada@example.com', role: 'admin', addedAt: now, signedUp: true }],
      });
    }
    return reply(route, { error: 'not found' }, 404);
  });
  return { responses };
}

test('phase 1c: create a project and add a secret that is never shown again', async ({ page }) => {
  const watch = watchForPageProblems(page);
  const api = await fakeApi(page);

  await test.step('Signed in (API answered by the test): projects, usage and admin are shown', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('Workspace time: 0 min.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  });

  await test.step('Create a project: it is listed, with its workspace not created yet', async () => {
    await page.getByLabel('Project name').fill('Rallly');
    await page.getByRole('button', { name: 'Create project' }).click();
    const list = page.getByRole('list', { name: 'Your projects' });
    await expect(list.getByText('Rallly')).toBeVisible();
    await expect(list.getByText(/Workspace not created yet/)).toBeVisible();
  });

  await test.step('Add a secret: listed by name, masked, and the value is gone from the page', async () => {
    await page.getByRole('button', { name: 'Secrets' }).click();
    await page.getByLabel('Name', { exact: true }).fill('STRIPE_KEY');
    await page.getByLabel('Value', { exact: true }).fill(SECRET_VALUE);
    await page.getByRole('button', { name: 'Save secret' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved STRIPE_KEY.');
    const saved = page.getByRole('list', { name: 'Saved secrets' });
    await expect(saved.getByText('STRIPE_KEY')).toBeVisible();
    await expect(saved.getByLabel('Value hidden')).toBeVisible();
    await expect(page.getByLabel('Value', { exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain(SECRET_VALUE);
    expect(api.responses.join('\n')).not.toContain(SECRET_VALUE);
  });

  expect(watch.problems()).toEqual([]);
});
