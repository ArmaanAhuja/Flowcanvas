// /api/projects/:id/workspace/terminal through the whole API, with fake WebSockets on both sides.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider, FakeSocket } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { ProviderError } from './provider.js';
import { TOUCH_EVERY_MS } from './terminal-routes.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused', APP_ORIGIN: APP };

let db: Database;
let provider: FakeProvider;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let now: number;
let ada: { cookie: string; userId: string };
let projectId: string;
/** The browser's side of each accepted terminal. */
let browsers: FakeSocket[];

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  log = vi.fn<(message: string) => void>();
  now = Date.UTC(2026, 10, 4, 12);
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

async function connect(
  options: { query?: string; cookie?: string; origin?: string; upgrade?: string } = {},
) {
  const response = await api().request(
    `${APP}/api/projects/${projectId}/workspace/terminal${options.query ?? '?cols=80&rows=24'}`,
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

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

describe('opening a terminal', () => {
  beforeEach(async () => {
    await post('/open');
  });

  it('connects the browser to a shell in the workspace, at its size', async () => {
    expect(await connect()).toEqual({ status: 200, text: 'upgraded' });
    expect(provider.terminals.map(({ size }) => size)).toEqual([{ cols: 80, rows: 24 }]);
    const [browser] = browsers;
    const workspace = provider.terminals[0]?.socket;
    // Both sides accepted, and both deliver bytes as ArrayBuffers, never Blobs.
    expect([browser?.accepted, workspace?.accepted]).toEqual([true, true]);
    expect([browser?.binaryType, workspace?.binaryType]).toEqual(['arraybuffer', 'arraybuffer']);
  });

  it('carries bytes both ways, and passes valid resizes on', async () => {
    await connect();
    const browser = browsers[0];
    const workspace = provider.terminals[0]?.socket;
    if (browser === undefined || workspace === undefined) throw new Error('not connected');
    browser.emit('message', bytes('ls\r'));
    expect(workspace.sent).toEqual([bytes('ls\r')]);
    workspace.emit('message', bytes('package.json\r\n'));
    workspace.emit('message', '{"type":"exit","code":0}');
    expect(browser.sent).toEqual([bytes('package.json\r\n'), '{"type":"exit","code":0}']);
    browser.emit('message', JSON.stringify({ type: 'resize', cols: 120, rows: 40, extra: 'x' }));
    expect(workspace.sent.at(-1)).toBe('{"type":"resize","cols":120,"rows":40}');
  });

  it('never passes anything else from the browser on', async () => {
    await connect();
    const browser = browsers[0];
    const workspace = provider.terminals[0]?.socket;
    if (browser === undefined || workspace === undefined) throw new Error('not connected');
    for (const message of [
      'ls',
      '{"type":"resize","cols":100000,"rows":1}',
      '{"type":"exec","command":"id"}',
      `{"type":"resize","cols":80,"rows":24,"pad":"${'x'.repeat(2000)}"}`,
      new ArrayBuffer(64 * 1024 + 1),
      { not: 'a frame' },
    ]) {
      browser.emit('message', message);
    }
    expect(workspace.sent).toEqual([]);
    expect(
      browser.sent.every((message) => typeof message === 'string' && message.includes('"error"')),
    ).toBe(true);
  });

  it('closes both sides when either side closes', async () => {
    await connect();
    browsers[0]?.emit('close');
    expect(provider.terminals[0]?.socket.closed).toEqual({ code: 1000, reason: 'terminal closed' });
    await connect();
    provider.terminals[1]?.socket.emit('close');
    expect(browsers[1]?.closed).toEqual({ code: 1000, reason: 'terminal closed' });
  });

  it('counts typing as activity, at most every 30 seconds', async () => {
    await connect();
    const lastActive = async () =>
      (
        await db.query<{ ms: number }>(
          'select (extract(epoch from last_active_at) * 1000)::float8 as ms from workspaces',
        )
      )[0]?.ms;
    const opened = await lastActive();
    now += 60_000;
    browsers[0]?.emit('message', bytes('a'));
    await vi.waitFor(async () => {
      expect(await lastActive()).toBe(now);
    });
    const touched = now;
    now += TOUCH_EVERY_MS - 1;
    browsers[0]?.emit('message', bytes('b'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await lastActive()).toBe(touched);
    expect(opened).toBeLessThan(touched);
  });

  it('logs who opened it, never what was typed', async () => {
    await connect();
    browsers[0]?.emit('message', bytes('echo CANARY-typed'));
    provider.terminals[0]?.socket.emit('message', bytes('CANARY-shown'));
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines).toContainEqual(
      expect.stringMatching(/^workspace [0-9a-f-]{36} terminal opened by user [0-9a-f-]{36}$/),
    );
    expect(lines.join('\n')).not.toContain('CANARY');
  });

  it("passes the workspace's refusal on", async () => {
    provider.failNext(
      'terminal',
      new ProviderError('refused', 'This workspace already has 4 terminals open.'),
    );
    expect(await connect()).toEqual({
      status: 503,
      text: JSON.stringify({
        error: 'This workspace already has 4 terminals open.',
        code: 'refused',
      }),
    });
    expect(browsers).toEqual([]);
  });
});

describe('refused before any WebSocket', () => {
  it('needs the workspace running', async () => {
    expect(await connect()).toMatchObject({ status: 409 });
    await post('/open');
    await post('/sleep');
    expect(await connect()).toMatchObject({ status: 409 });
    expect(provider.terminals).toEqual([]);
  });

  it('needs our own page (against cross-site WebSocket hijacking), a session and the owner', async () => {
    await post('/open');
    expect((await connect({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await connect({ cookie: '' })).status).toBe(401);
    const grace = await signedInAs(db, 'grace@example.com');
    expect((await connect({ cookie: grace.cookie })).status).toBe(404);
    expect(provider.terminals).toEqual([]);
  });

  it('needs a WebSocket and a sensible size', async () => {
    await post('/open');
    expect((await connect({ upgrade: '' })).status).toBe(426);
    for (const query of [
      '',
      '?cols=80',
      '?cols=0&rows=24',
      '?cols=80&rows=9999',
      '?cols=a&rows=b',
    ]) {
      expect((await connect({ query })).status, query).toBe(400);
    }
    expect(provider.terminals).toEqual([]);
  });
});
