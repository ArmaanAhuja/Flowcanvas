// /api/projects/:id/workspace/index/{status,search} through the whole API, with a fake provider (phase 4).
// @vitest-environment node
import type { EngineStatus } from '@flowcanvas/engine/protocol';
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

const status: EngineStatus = {
  state: 'indexing',
  done: 400,
  total: 1958,
  files: 400,
  byStatus: { parsed: 300, 'no-grammar': 100, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: 1200,
  withSyntaxErrors: 0,
  partlyRead: 3,
  lastFullMs: null,
  message: null,
};

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
  now = Date.UTC(2026, 10, 11, 12);
  ada = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, ada.userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
});

async function call(method: string, path: string, cookie = ada.cookie) {
  const api = createApi({
    database: () => db,
    log,
    now: () => now,
    workspaceProvider: () => provider,
  });
  const response = await api.request(
    `${APP}/api/projects/${projectId}/workspace${path}`,
    { method, headers: { cookie, origin: APP } },
    env,
  );
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const lastActive = async () => {
  const [row] = await db.query<{ ms: number }>(
    'select (extract(epoch from last_active_at) * 1000)::float8 as ms from workspaces',
  );
  return row?.ms;
};

describe('while the workspace runs', () => {
  let opened: number;
  beforeEach(async () => {
    await call('POST', '/open');
    opened = now;
  });

  it('gives the index status, without counting as activity (indexing never keeps it awake)', async () => {
    provider.indexAnswer = { ok: true, result: status };
    now += 9 * 60_000;
    expect(await call('GET', '/index/status')).toEqual({ status: 200, json: status });
    expect(provider.indexRequests.map(({ request }) => request)).toEqual([{ op: 'status' }]);
    expect(await lastActive()).toBe(opened);
  });

  it('searches with the query and limit, and counts as activity', async () => {
    const result = {
      symbols: [
        {
          path: 'apps/web/src/features/poll/mutations.ts',
          name: 'createPoll',
          kind: 'function',
          container: null,
          line: 98,
          column: 14,
          exported: true,
        },
      ],
      ms: 2,
    } as const;
    provider.indexAnswer = { ok: true, result };
    now += 9 * 60_000;
    expect(await call('GET', '/index/search?q=create%20poll&limit=10')).toEqual({
      status: 200,
      json: result,
    });
    await call('GET', '/index/search?q=poll');
    expect(provider.indexRequests.map(({ request }) => request)).toEqual([
      { op: 'search', query: 'create poll', limit: 10 },
      { op: 'search', query: 'poll', limit: 50 },
    ]);
    expect(await lastActive()).toBe(now);
  });

  it.each([
    ['/index/search', 'Give something to search for.'],
    ['/index/search?q=x&limit=0', 'Ask for 1 to 100 results.'],
    ['/index/search?q=x&limit=lots', 'Ask for 1 to 100 results.'],
    [`/index/search?q=${'x'.repeat(101)}`, 'Keep searches under 100 characters.'],
  ])('refuses %s itself, without asking the workspace', async (path, error) => {
    expect(await call('GET', path)).toEqual({
      status: 400,
      json: { error, code: 'invalid_request' },
    });
    expect(provider.indexRequests).toEqual([]);
  });

  it('passes on the engine’s refusal, and logs the outcome but never the query', async () => {
    provider.indexAnswer = {
      ok: false,
      error: { code: 'failed', message: 'The engine couldn’t answer that.' },
    };
    expect(await call('GET', '/index/search?q=CANARY-query')).toEqual({
      status: 502,
      json: { error: 'The engine couldn’t answer that.', code: 'failed' },
    });
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines.some((line) => / index search by user [0-9a-f-]{36}: failed$/.test(line))).toBe(
      true,
    );
    for (const line of lines) expect(line).not.toContain('CANARY');
  });

  it('says what went wrong when the provider could not be asked', async () => {
    provider.failNext(
      'index',
      new ProviderError(
        'failed',
        'The project index stopped. Reopen the project to start it again.',
      ),
    );
    expect(await call('GET', '/index/status')).toEqual({
      status: 502,
      json: {
        error: 'The project index stopped. Reopen the project to start it again.',
        code: 'failed',
      },
    });
  });
});

describe('TypeScript’s answers (phase 5)', () => {
  let opened: number;
  beforeEach(async () => {
    await call('POST', '/open');
    opened = now;
  });

  it('asks the four questions about a place, and each counts as activity', async () => {
    const answer = {
      target: null,
      entries: [],
      complete: true,
      message: 'Put the cursor on a function, method or component to see its calls.',
    };
    provider.indexAnswer = { ok: true, result: answer };
    now += 9 * 60_000;
    expect(
      await call('GET', '/index/callers?path=apps%2Fweb%2Fsrc%2Fpage.tsx&line=6&column=17'),
    ).toEqual({ status: 200, json: answer });
    await call('GET', '/index/callees?path=a.ts&line=1&column=1');
    await call('GET', '/index/definition?path=a.ts&line=2&column=3');
    await call('GET', '/index/references?path=a.ts&line=4&column=5');
    expect(provider.indexRequests.map(({ request }) => request)).toEqual([
      { op: 'callers', path: 'apps/web/src/page.tsx', line: 6, column: 17 },
      { op: 'callees', path: 'a.ts', line: 1, column: 1 },
      { op: 'definition', path: 'a.ts', line: 2, column: 3 },
      { op: 'references', path: 'a.ts', line: 4, column: 5 },
    ]);
    expect(await lastActive()).toBe(now);
    expect(opened).toBeLessThan(now);
  });

  it.each([
    ['/index/callers?line=1&column=1', 'Give a file in the project, like src/index.ts.'],
    [
      '/index/callers?path=%2Fetc%2Fpasswd&line=1&column=1',
      'Give a file in the project, like src/index.ts.',
    ],
    [
      '/index/callees?path=..%2Fx.ts&line=1&column=1',
      'Give a file in the project, like src/index.ts.',
    ],
    ['/index/definition?path=a.ts&line=0&column=1', 'Give a line and a column, counting from 1.'],
    ['/index/references?path=a.ts&line=1', 'Give a line and a column, counting from 1.'],
  ])('refuses %s itself, without asking the workspace', async (path, error) => {
    expect(await call('GET', path)).toEqual({
      status: 400,
      json: { error, code: 'invalid_request' },
    });
    expect(provider.indexRequests).toEqual([]);
  });
});

it('needs a running workspace', async () => {
  expect(await call('GET', '/index/status')).toEqual({
    status: 409,
    json: { error: NOT_RUNNING, code: 'not_running' },
  });
  expect(provider.indexRequests).toEqual([]);
});

it('is the owner’s only', async () => {
  await call('POST', '/open');
  const grace = await signedInAs(db, 'grace@example.com');
  expect((await call('GET', '/index/search?q=poll', grace.cookie)).status).toBe(404);
  expect(provider.indexRequests).toEqual([]);
});
