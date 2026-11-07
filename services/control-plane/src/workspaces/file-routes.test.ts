// /api/projects/:id/workspace/{files,file,exec} through the whole API, with a fake provider and agent.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { NOT_RUNNING } from './file-routes.js';
import { ProviderError } from './provider.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused', APP_ORIGIN: APP };

let db: Database;
let provider: FakeProvider;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let now: number;
let ada: { cookie: string; userId: string };
let projectId: string;

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  log = vi.fn<(message: string) => void>();
  now = Date.UTC(2026, 10, 4, 12);
  ada = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, ada.userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
});

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; origin?: string } = {},
) {
  const api = createApi({
    database: () => db,
    log,
    now: () => now,
    workspaceProvider: () => provider,
  });
  const response = await api.request(
    `${APP}/api/projects/${projectId}/workspace${path}`,
    {
      method,
      headers: {
        cookie: options.cookie ?? ada.cookie,
        origin: options.origin ?? APP,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    },
    env,
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

const open = () => call('POST', '/open');

describe('while the workspace runs', () => {
  beforeEach(async () => {
    await open();
  });

  it('lists, reads, writes and runs through the agent', async () => {
    const list = { ok: true, result: { path: '', entries: [], truncated: false } } as const;
    provider.agentAnswer = list;
    expect(await call('GET', '/files?path=src')).toEqual({ status: 200, json: list.result });
    await call('GET', '/file?path=package.json');
    await call('PUT', '/file?path=notes.md', { body: { content: '# Hi', encoding: 'utf8' } });
    await call('POST', '/exec', { body: { command: ['git', 'status'], cwd: '' } });
    expect(provider.agentRequests.map(({ request }) => request)).toEqual([
      { op: 'list', path: 'src' },
      { op: 'read', path: 'package.json' },
      { op: 'write', path: 'notes.md', content: '# Hi', encoding: 'utf8' },
      { op: 'exec', command: ['git', 'status'], cwd: '', timeoutMs: 30_000 },
    ]);
  });

  it('lists every file, and passes a conflict-safe write on only when it has a base version', async () => {
    const tree = {
      ok: true,
      result: { files: ['src/index.ts'], truncated: false, source: 'git' },
    } as const;
    provider.agentAnswer = tree;
    expect(await call('GET', '/tree')).toEqual({ status: 200, json: tree.result });
    const version = 'a'.repeat(64);
    await call('PUT', '/file?path=a.ts', { body: { content: 'x', baseVersion: version } });
    await call('PUT', '/file?path=b.ts', { body: { content: 'x', baseVersion: null } });
    await call('PUT', '/file?path=c.ts', { body: { content: 'x' } });
    expect(provider.agentRequests.map(({ request }) => request)).toEqual([
      { op: 'files' },
      { op: 'write', path: 'a.ts', content: 'x', encoding: 'utf8', baseVersion: version },
      { op: 'write', path: 'b.ts', content: 'x', encoding: 'utf8', baseVersion: null },
      { op: 'write', path: 'c.ts', content: 'x', encoding: 'utf8' },
    ]);
  });

  it('keeps, lists, gives back and drops unsaved changes through the journal', async () => {
    const version = 'b'.repeat(64);
    await call('PUT', '/journal/entry?path=src/a.ts', {
      body: { content: 'draft', baseVersion: version, revision: 4 },
    });
    await call('GET', '/journal');
    await call('GET', '/journal/entry?path=src/a.ts');
    await call('DELETE', '/journal/entry?path=src/a.ts&revision=4');
    expect(provider.agentRequests.map(({ request }) => request)).toEqual([
      { op: 'journal-put', path: 'src/a.ts', content: 'draft', baseVersion: version, revision: 4 },
      { op: 'journal-list' },
      { op: 'journal-get', path: 'src/a.ts' },
      { op: 'journal-drop', path: 'src/a.ts', revision: 4 },
    ]);
  });

  it('refuses journal requests that are malformed or from another site', async () => {
    expect(await call('DELETE', '/journal/entry?path=a.ts')).toMatchObject({ status: 400 });
    expect(await call('DELETE', '/journal/entry?path=a.ts&revision=x')).toMatchObject({
      status: 400,
    });
    expect(
      await call('PUT', '/journal/entry?path=a.ts', { body: { content: 'x', baseVersion: null } }),
    ).toMatchObject({ status: 400 });
    expect(
      await call('PUT', '/journal/entry?path=a.ts', {
        body: { content: 'x', baseVersion: null, revision: 1 },
        origin: 'https://evil.example',
      }),
    ).toMatchObject({ status: 403 });
    expect(
      await call('DELETE', '/journal/entry?path=a.ts&revision=1', {
        origin: 'https://evil.example',
      }),
    ).toMatchObject({ status: 403 });
    expect(provider.agentRequests).toEqual([]);
  });

  it("passes the agent's refusals on with a matching status", async () => {
    for (const [code, status] of [
      ['secret_file', 403],
      ['not_found', 404],
      ['outside_project', 403],
      ['too_large', 413],
      ['conflict', 409],
      ['failed', 502],
    ] as const) {
      provider.agentAnswer = { ok: false, error: { code, message: 'A sentence.' } };
      expect(await call('GET', '/file?path=x')).toEqual({
        status,
        json: { error: 'A sentence.', code },
      });
    }
  });

  it('checks the request before it goes anywhere', async () => {
    expect(await call('GET', '/file?path=/etc/passwd')).toMatchObject({
      status: 403,
      json: { code: 'outside_project' },
    });
    expect(await call('GET', '/file')).toMatchObject({
      status: 400,
      json: { code: 'invalid_request' },
    });
    expect(await call('POST', '/exec', { body: { command: 'rm -rf /' } })).toMatchObject({
      status: 400,
    });
    expect(provider.agentRequests).toEqual([]);
  });

  it('counts as activity, so the workspace does not sleep under you', async () => {
    now += 9 * 60_000;
    await call('GET', '/files');
    const [row] = await db.query<{ ms: number }>(
      'select (extract(epoch from last_active_at) * 1000)::float8 as ms from workspaces',
    );
    expect(row?.ms).toBe(now);
  });

  it('logs the operation and outcome, never the path, content or command', async () => {
    await call('PUT', '/file?path=secret-plans.md', { body: { content: 'CANARY-content' } });
    await call('PUT', '/journal/entry?path=secret-plans.md', {
      body: { content: 'CANARY-journal', baseVersion: null, revision: 1 },
    });
    await call('POST', '/exec', { body: { command: ['echo', 'CANARY-command'] } });
    const lines = log.mock.calls.map(([line]) => line).filter((line) => line.includes(' by user '));
    expect(lines.some((line) => / write by user [0-9a-f-]{36}: ok$/.test(line))).toBe(true);
    expect(lines.some((line) => / exec by user [0-9a-f-]{36}: ok$/.test(line))).toBe(true);
    expect(lines.some((line) => / journal-put by user [0-9a-f-]{36}: ok$/.test(line))).toBe(true);
    for (const line of log.mock.calls.map(([l]) => l)) {
      expect(line).not.toContain('CANARY');
      expect(line).not.toContain('secret-plans');
    }
  });

  it('says what went wrong when the provider could not be asked', async () => {
    provider.failNext(
      'agent',
      new ProviderError('unavailable', "The workspace host isn't running."),
    );
    expect(await call('GET', '/files')).toEqual({
      status: 503,
      json: { error: "The workspace host isn't running.", code: 'unavailable' },
    });
  });
});

describe('otherwise', () => {
  it('needs the workspace to be running', async () => {
    expect(await call('GET', '/files')).toEqual({
      status: 409,
      json: { error: NOT_RUNNING, code: 'not_running' },
    });
    await open();
    await call('POST', '/sleep');
    expect((await call('GET', '/files')).status).toBe(409);
    expect(provider.agentRequests).toEqual([]);
  });

  it('is for the owner only, signed in, and changes come from our own pages', async () => {
    await open();
    const grace = await signedInAs(db, 'grace@example.com');
    expect((await call('GET', '/files', { cookie: grace.cookie })).status).toBe(404);
    expect((await call('GET', '/files', { cookie: '' })).status).toBe(401);
    expect(
      (
        await call('PUT', '/file?path=x', {
          body: { content: 'x' },
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('POST', '/exec', { body: { command: ['id'] }, origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(provider.agentRequests).toEqual([]);
  });
});
