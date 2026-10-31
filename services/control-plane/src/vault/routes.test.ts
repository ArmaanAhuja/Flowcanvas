// /api/projects/:id/secrets through the whole API, with a canary value that must never come back out.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { testVaultKey } from '../test/vault-key.js';

const APP = 'https://flowcanvas.example.workers.dev';
const CANARY = 'CANARY-sk_live_4242424242';

let db: Database;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let env: { DATABASE_URL: string; APP_ORIGIN: string; VAULT_KEY: string };
let ada: { cookie: string; userId: string };
let projectId: string;
/** Every response body, to check none ever contains the canary. */
let bodies: string[];

beforeEach(async () => {
  db = await migratedDatabase();
  log = vi.fn<(message: string) => void>();
  env = { DATABASE_URL: 'postgresql://unused', APP_ORIGIN: APP, VAULT_KEY: testVaultKey() };
  ada = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, ada.userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
  bodies = [];
});

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; origin?: string; env?: object } = {},
) {
  const response = await createApi({ database: () => db, log }).request(
    `${APP}/api/projects/${path}`,
    {
      method,
      headers: {
        cookie: options.cookie ?? ada.cookie,
        origin: options.origin ?? APP,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined
        ? {}
        : { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }),
    },
    options.env ?? env,
  );
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, json: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

const put = (name: string, value: unknown, options = {}) =>
  call('PUT', `${projectId}/secrets/${name}`, { body: { value }, ...options });

describe('secrets API', () => {
  it('saves a secret (201), replaces it (200) and lists names only', async () => {
    expect(await put('STRIPE_KEY', CANARY)).toEqual({
      status: 201,
      json: { name: 'STRIPE_KEY', result: 'created' },
    });
    expect((await put('STRIPE_KEY', `${CANARY}-rotated`)).status).toBe(200);
    const { json } = await call('GET', `${projectId}/secrets`);
    expect(json).toEqual({
      secrets: [
        {
          name: 'STRIPE_KEY',
          addedBy: 'ada',
          createdAt: expect.any(String) as string,
          updatedAt: expect.any(String) as string,
        },
      ],
    });
  });

  it('never returns or logs a value, even when saving fails', async () => {
    await put('STRIPE_KEY', CANARY);
    await put('bad-name', CANARY);
    await put('STRIPE_KEY', CANARY, { env: { ...env, VAULT_KEY: '' } });
    const failing = createApi({
      database: () => ({ query: () => Promise.reject(new Error('database down')) }),
      log,
    });
    await failing.request(
      `${APP}/api/projects/${projectId}/secrets/STRIPE_KEY`,
      {
        method: 'PUT',
        headers: { cookie: ada.cookie, origin: APP, 'content-type': 'application/json' },
        body: JSON.stringify({ value: CANARY }),
      },
      env,
    );
    expect(bodies.join('\n')).not.toContain('CANARY');
    expect(log.mock.calls.flat().join('\n')).not.toContain('CANARY');
  });

  it('needs a signed-in person, and treats other people’s projects as missing', async () => {
    expect((await call('GET', `${projectId}/secrets`, { cookie: '' })).status).toBe(401);
    const grace = await signedInAs(db, 'grace@example.com');
    expect((await call('GET', `${projectId}/secrets`, { cookie: grace.cookie })).status).toBe(404);
    expect((await put('STRIPE_KEY', CANARY, { cookie: grace.cookie })).status).toBe(404);
    expect((await call('GET', 'not-a-uuid/secrets')).status).toBe(404);
    expect((await call('GET', '00000000-0000-4000-8000-000000000000/secrets')).json).toEqual({
      error: 'No such project.',
    });
  });

  it('explains bad names and values, naming the field', async () => {
    expect(await put('database_url', 'x')).toMatchObject({ status: 400, json: { field: 'name' } });
    expect(await put('DATABASE_URL', '')).toMatchObject({ status: 400, json: { field: 'value' } });
    expect((await put('BIG', 'x'.repeat(140_000))).status).toBe(413);
  });

  it('says how to fix a missing master key', async () => {
    expect(await put('STRIPE_KEY', 'x', { env: { ...env, VAULT_KEY: '' } })).toEqual({
      status: 503,
      json: { error: 'The secrets vault isn’t set up here (VAULT_KEY is missing).' },
    });
  });

  it('accepts changes only from Flowcanvas itself', async () => {
    expect((await put('STRIPE_KEY', 'x', { origin: 'https://evil.example' })).status).toBe(403);
    await put('STRIPE_KEY', 'x');
    expect(
      (await call('DELETE', `${projectId}/secrets/STRIPE_KEY`, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
  });

  it('deletes a secret, then says it’s gone', async () => {
    await put('STRIPE_KEY', 'x');
    expect((await call('DELETE', `${projectId}/secrets/STRIPE_KEY`)).status).toBe(204);
    expect((await call('DELETE', `${projectId}/secrets/STRIPE_KEY`)).status).toBe(404);
    expect((await call('GET', `${projectId}/secrets`)).json).toEqual({ secrets: [] });
  });
});
