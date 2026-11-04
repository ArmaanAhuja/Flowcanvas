// /api/projects/:id/workspace through the whole API, with a fake provider.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { ProviderError } from './provider.js';
import { WORKSPACES_UNAVAILABLE } from './routes.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused', APP_ORIGIN: APP };

let db: Database;
let provider: FakeProvider | undefined;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let ada: { cookie: string; userId: string };
let projectId: string;
let bodies: string[];

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  log = vi.fn<(message: string) => void>();
  ada = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, ada.userId, {
    name: 'Rallly',
    repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
  });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
  bodies = [];
});

async function call(
  method: string,
  path: string,
  options: { cookie?: string; origin?: string; project?: string } = {},
) {
  const api = createApi({ database: () => db, log, workspaceProvider: () => provider });
  const response = await api.request(
    `${APP}/api/projects/${options.project ?? projectId}/workspace${path}`,
    { method, headers: { cookie: options.cookie ?? ada.cookie, origin: options.origin ?? APP } },
    env,
  );
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

describe('GET /api/projects/:id/workspace', () => {
  it('shows the workspace and whether workspaces can run here', async () => {
    expect(await call('GET', '')).toMatchObject({
      status: 200,
      json: { workspace: { state: 'not_created', failure: null }, available: true },
    });
    provider = undefined;
    expect((await call('GET', '')).json).toMatchObject({ available: false });
  });

  it("answers another person's project like a missing one", async () => {
    const grace = await signedInAs(db, 'grace@example.com');
    expect((await call('GET', '', { cookie: grace.cookie })).status).toBe(404);
    expect((await call('GET', '', { project: 'nope' })).status).toBe(404);
    expect((await call('GET', '', { cookie: '' })).status).toBe(401);
  });
});

describe('POST /api/projects/:id/workspace/:action', () => {
  it('opens, sleeps, resumes and stops', async () => {
    expect(await call('POST', '/open')).toMatchObject({
      status: 200,
      json: { workspace: { state: 'running' } },
    });
    expect((await call('POST', '/sleep')).json).toMatchObject({ workspace: { state: 'sleeping' } });
    expect((await call('POST', '/resume')).json).toMatchObject({ workspace: { state: 'running' } });
    expect((await call('POST', '/stop')).json).toMatchObject({ workspace: { state: 'stopped' } });
  });

  it('says workspaces run locally where there is no provider (staging)', async () => {
    provider = undefined;
    expect(await call('POST', '/open')).toMatchObject({
      status: 503,
      json: {
        error: WORKSPACES_UNAVAILABLE,
        problem: 'unavailable',
        workspace: { state: 'not_created' },
      },
    });
  });

  it('maps problems to statuses, with the sentence to show', async () => {
    expect(await call('POST', '/sleep')).toMatchObject({
      status: 409,
      json: { problem: 'conflict', error: 'Only a running workspace can sleep.' },
    });
    provider?.failNext(
      'create',
      new ProviderError('failed', 'The repository could not be cloned.'),
    );
    expect(await call('POST', '/open')).toMatchObject({
      status: 502,
      json: { problem: 'failed', workspace: { state: 'failed' } },
    });
    provider?.failNext('create', new ProviderError('refused', 'Your computer is low on memory.'));
    expect(await call('POST', '/open')).toMatchObject({
      status: 503,
      json: { problem: 'refused', error: 'Your computer is low on memory.' },
    });
  });

  it('only takes requests from our own pages, signed in, for their own project', async () => {
    expect((await call('POST', '/open', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/open', { cookie: '' })).status).toBe(401);
    const grace = await signedInAs(db, 'grace@example.com');
    expect((await call('POST', '/open', { cookie: grace.cookie })).status).toBe(404);
    expect(provider?.calls).toEqual([]);
  });

  it('knows only the four actions', async () => {
    expect((await call('POST', '/delete')).status).toBe(404);
    expect((await call('POST', '/open/extra')).status).toBe(404);
    expect((await call('POST', '/xopen')).status).toBe(404);
    expect(provider?.calls).toEqual([]);
  });

  it("never shows the provider's own name for the workspace", async () => {
    await call('POST', '/open');
    await call('GET', '');
    for (const body of bodies) {
      expect(body).not.toContain('fake-');
      expect(body).not.toContain('provider');
    }
  });

  it('logs changes by IDs only', async () => {
    await call('POST', '/open');
    const line = log.mock.calls.map(([message]) => message).find((m) => m.includes(' open by '));
    expect(line).toMatch(
      /^workspace [0-9a-f-]{36} open by user [0-9a-f-]{36}: not_created → running$/,
    );
    expect(line).not.toContain('ada');
    expect(line).not.toContain('github.com');
  });
});
