// /api/projects/:id/workspace/events through the whole API, with fake WebSockets on both sides (phase 3).
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider, FakeSocket } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { ProviderError } from './provider.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused', APP_ORIGIN: APP };
const version = 'd'.repeat(64);

let db: Database;
let provider: FakeProvider;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let now: number;
let ada: { cookie: string; userId: string };
let projectId: string;
let browsers: FakeSocket[];

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  log = vi.fn<(message: string) => void>();
  now = Date.UTC(2026, 10, 7, 12);
  browsers = [];
  ada = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, ada.userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
});

function api() {
  return createApi({
    database: () => db,
    log,
    now: () => now,
    workspaceProvider: () => provider,
    acceptWebSocket: () => {
      const socket = new FakeSocket();
      browsers.push(socket);
      // A stand-in for the 101 response, which Node's Response can't make.
      return { response: new Response('upgraded', { status: 200 }), socket };
    },
  });
}

async function connect(options: { cookie?: string; origin?: string; upgrade?: string } = {}) {
  const response = await api().request(
    `${APP}/api/projects/${projectId}/workspace/events`,
    {
      headers: {
        cookie: options.cookie ?? ada.cookie,
        origin: options.origin ?? APP,
        upgrade: options.upgrade ?? 'websocket',
      },
    },
    env,
  );
  return { status: response.status, text: await response.text() };
}

const post = (path: string) =>
  api().request(
    `${APP}/api/projects/${projectId}/workspace${path}`,
    { method: 'POST', headers: { cookie: ada.cookie, origin: APP } },
    env,
  );

const lastActive = async () => {
  const [row] = await db.query<{ ms: number }>(
    'select (extract(epoch from last_active_at) * 1000)::float8 as ms from workspaces',
  );
  return row?.ms;
};

describe('following changes in the workspace', () => {
  beforeEach(async () => {
    await post('/open');
  });

  it("passes the workspace's checked events to the page, and nothing else", async () => {
    expect(await connect()).toEqual({ status: 200, text: 'upgraded' });
    const [watcher] = provider.watchers;
    const [browser] = browsers;
    if (watcher === undefined || browser === undefined) throw new Error('not connected');
    expect(watcher.socket.accepted && browser.accepted).toBe(true);
    const good = { type: 'changed', path: 'src/a.ts', deleted: false, version };
    for (const data of [
      JSON.stringify({ type: 'ready', folders: 3, files: 9 }),
      JSON.stringify({ type: 'changed', path: '.env', deleted: false, version }),
      JSON.stringify({ type: 'changed', path: '../outside', deleted: false, version }),
      'not json',
      new TextEncoder().encode(JSON.stringify(good)).buffer,
      JSON.stringify({ ...good, padding: 'x'.repeat(5000) }),
      JSON.stringify(good),
    ]) {
      watcher.socket.emit('message', data);
    }
    // Text frames only: a binary frame would fail the parse.
    expect(
      browser.sent.map((sent) => JSON.parse(typeof sent === 'string' ? sent : '') as unknown),
    ).toEqual([{ type: 'ready', folders: 3, files: 9 }, good]);
  });

  it('sends nothing from the page to the workspace', async () => {
    await connect();
    browsers[0]?.emit('message', JSON.stringify({ op: 'write', path: 'a.ts' }));
    browsers[0]?.emit('message', new TextEncoder().encode('rm -rf /').buffer);
    expect(provider.watchers[0]?.socket.sent).toEqual([]);
  });

  it('is not activity: a page left open does not keep the workspace awake', async () => {
    const opened = await lastActive();
    now += 9 * 60_000;
    await connect();
    for (let i = 0; i < 20; i++) {
      provider.watchers[0]?.socket.emit(
        'message',
        JSON.stringify({ type: 'changed', path: `f${String(i)}.ts`, deleted: false, version }),
      );
    }
    expect(await lastActive()).toBe(opened);
  });

  it('closes both sides when either ends', async () => {
    await connect();
    provider.watchers[0]?.socket.close(1000, 'watcher ended');
    expect(browsers[0]?.closed).toBeDefined();
    await connect();
    browsers[1]?.close();
    expect(provider.watchers[1]?.socket.closed).toBeDefined();
  });

  it('logs who and which workspace, never a file name', async () => {
    await connect();
    provider.watchers[0]?.socket.emit(
      'message',
      JSON.stringify({ type: 'changed', path: 'secret-plans.ts', deleted: false, version }),
    );
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines.some((line) => /watching opened by user [0-9a-f-]{36}$/.test(line))).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-plans');
  });

  it('says why the provider could not follow changes', async () => {
    provider.failNext('events', new ProviderError('refused', 'Close a tab first.'));
    expect(await connect()).toEqual({
      status: 503,
      text: JSON.stringify({ error: 'Close a tab first.', code: 'refused' }),
    });
  });
});

describe('otherwise', () => {
  it('needs the workspace to be running', async () => {
    expect(await connect()).toMatchObject({ status: 409 });
    await post('/open');
    await post('/sleep');
    expect(await connect()).toMatchObject({ status: 409 });
    expect(provider.watchers).toEqual([]);
  });

  it('is for the owner, from our own pages, over a WebSocket only', async () => {
    await post('/open');
    const bob = await signedInAs(db, 'bob@example.com');
    expect(await connect({ cookie: bob.cookie })).toMatchObject({ status: 404 });
    expect(await connect({ cookie: '' })).toMatchObject({ status: 401 });
    expect(await connect({ origin: 'https://evil.example' })).toMatchObject({ status: 403 });
    expect(await connect({ upgrade: '' })).toMatchObject({ status: 426 });
    expect(provider.watchers).toEqual([]);
  });
});
