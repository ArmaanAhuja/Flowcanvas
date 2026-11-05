// /api/projects through the whole API: guards, validation, real SQL (PGlite).
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { WORKSPACES_UNAVAILABLE } from '../workspaces/provider.js';
import { demoProject } from './demo.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused-by-the-fake-database', APP_ORIGIN: APP };

let db: Database;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let ada: string;

beforeEach(async () => {
  db = await migratedDatabase();
  log = vi.fn<(message: string) => void>();
  ada = (await signedInAs(db, 'ada@example.com')).cookie;
});

const api = () => createApi({ database: () => db, log });

function list(cookie = ada) {
  return api().request(`${APP}/api/projects`, { headers: { cookie } }, env);
}

function create(body: unknown, headers: Record<string, string> = {}) {
  return api().request(
    `${APP}/api/projects`,
    {
      method: 'POST',
      headers: { cookie: ada, origin: APP, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );
}

describe('/api/projects', () => {
  it('needs a signed-in person', async () => {
    const response = await api().request(`${APP}/api/projects`, {}, env);
    expect(response.status).toBe(401);
  });

  it('starts empty, then lists what was created', async () => {
    expect(await (await list()).json()).toEqual({ projects: [], workspacesAvailable: false });

    const response = await create({
      name: 'Rallly',
      repoUrl: 'https://github.com/lukevella/rallly',
    });
    expect(response.status).toBe(201);
    const { project } = (await response.json()) as { project: Record<string, unknown> };
    expect(project).toMatchObject({
      name: 'Rallly',
      repoUrl: 'https://github.com/lukevella/rallly',
    });

    expect(await (await list()).json()).toEqual({
      projects: [project],
      workspacesAvailable: false,
    });
  });

  it('shows each person only their own projects', async () => {
    await create({ name: 'Rallly' });
    const grace = (await signedInAs(db, 'grace@example.com')).cookie;
    expect(await (await list(grace)).json()).toEqual({ projects: [], workspacesAvailable: false });
  });

  it('explains a bad field, naming it', async () => {
    const response = await create({ name: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Give the project a name.', field: 'name' });
  });

  it('answers 409 for a name the person already uses', async () => {
    await create({ name: 'Rallly' });
    const response = await create({ name: 'Rallly' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'You already have a project with that name.',
      field: 'name',
    });
  });

  it('accepts creation only from Flowcanvas itself', async () => {
    const response = await create({ name: 'Rallly' }, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(await (await list()).json()).toEqual({ projects: [], workspacesAvailable: false });
  });

  it('accepts only JSON, and only small bodies', async () => {
    expect(
      (await create('name=Rallly', { 'content-type': 'application/x-www-form-urlencoded' })).status,
    ).toBe(415);
    expect((await create('{not json')).status).toBe(400);
    expect((await create({ name: 'x', padding: 'a'.repeat(5000) })).status).toBe(413);
  });

  it('never stores or echoes a token pasted into the repository address', async () => {
    const response = await create({ name: 'Rallly', repoUrl: 'https://ghp_CANARY@github.com/x/y' });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('CANARY');
    expect(JSON.stringify(await db.query('select * from projects'))).not.toContain('CANARY');
  });

  it('says so when the database fails, without details', async () => {
    const failing = createApi({
      database: () => ({
        query: () => Promise.reject(new Error('could not connect to postgresql://u:CANARY@h/db')),
      }),
      log,
    });
    const response = await failing.request(
      `${APP}/api/projects`,
      { headers: { cookie: ada } },
      env,
    );
    expect(response.status).toBe(503);
    expect(log.mock.calls.flat().join('\n')).not.toContain('CANARY');
  });
});

describe('/api/projects/demo (Open demo project)', () => {
  const withProvider = () =>
    createApi({ database: () => db, log, workspaceProvider: () => new FakeProvider() });
  const openDemo = (options: { origin?: string; app?: ReturnType<typeof createApi> } = {}) =>
    (options.app ?? withProvider()).request(
      `${APP}/api/projects/demo`,
      { method: 'POST', headers: { cookie: ada, origin: options.origin ?? APP } },
      env,
    );

  it("is the corpus's Rallly fork at its pinned commit, never the fork's head", () => {
    expect(demoProject()).toEqual({
      name: 'Rallly (demo)',
      repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
      commit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
    });
  });

  it('makes the demo project the first time, and finds the same one after', async () => {
    const first = await openDemo();
    expect(first.status).toBe(201);
    const { project } = (await first.json()) as { project: Record<string, unknown> };
    expect(project).toMatchObject({
      name: 'Rallly (demo)',
      repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
      repoCommit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
      workspace: { state: 'not_created', failure: null },
    });
    const again = await openDemo();
    expect(again.status).toBe(200);
    expect(((await again.json()) as { project: { id: string } }).project.id).toBe(project.id);
    const listed = await withProvider().request(
      `${APP}/api/projects`,
      { headers: { cookie: ada } },
      env,
    );
    expect(await listed.json()).toMatchObject({ projects: [project], workspacesAvailable: true });
  });

  it('explains when another project already has its name', async () => {
    await create({ name: 'Rallly (demo)' });
    const response = await openDemo();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'You already have another project named Rallly (demo). Rename it, then try again.',
    });
  });

  it('makes nothing where workspaces can’t run (staging), and says so', async () => {
    const response = await openDemo({ app: api() });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: WORKSPACES_UNAVAILABLE, code: 'unavailable' });
    expect(await (await list()).json()).toEqual({ projects: [], workspacesAvailable: false });
  });

  it('accepts the click only from Flowcanvas itself', async () => {
    expect((await openDemo({ origin: 'https://evil.example' })).status).toBe(403);
    expect(await (await list()).json()).toEqual({ projects: [], workspacesAvailable: false });
  });

  it("refuses a commit that isn't a full SHA, or a pin without an address (the database's own check)", async () => {
    const { userId } = await signedInAs(db, 'grace@example.com');
    await expect(
      db.query(
        "insert into projects (owner_id, name, repo_url, repo_commit) values ($1, 'a', 'https://github.com/a/b', 'main')",
        [userId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into projects (owner_id, name, repo_commit) values ($1, 'b', '${'a'.repeat(40)}')`,
        [userId],
      ),
    ).rejects.toThrow(/projects_repo_commit_needs_url/);
  });
});
