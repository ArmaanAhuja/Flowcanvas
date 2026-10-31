// The phase 1c acceptance test for "saved secrets never appear in logs", across the whole API at once: sign in
// through a fake GitHub, create a project, save and replace a secret, read usage and the admin view, then make
// things fail (missing vault key, provider errors, database outage). Every value that must stay private is a
// canary; none may appear in any response, any log line, or anything written to the console.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { testVaultKey } from '../test/vault-key.js';
import { createApi } from './app.js';

const APP = 'https://flowcanvas.example.workers.dev';
const EMAIL = 'ada.canary@example.com';
const CANARIES = {
  secretValue: 'CANARY-secret-value-sk_live_123',
  rotatedValue: 'CANARY-rotated-value',
  clientSecret: 'CANARY-client-secret',
  code: 'CANARY-oauth-code',
  githubToken: 'gho_CANARYgithubtoken',
  databasePassword: 'CANARY-db-Pa55word',
};
const vaultKey = testVaultKey();
const env = {
  DATABASE_URL: `postgresql://owner:${CANARIES.databasePassword}@ep-canary.example.neon.tech/db`,
  APP_ORIGIN: APP,
  GITHUB_CLIENT_ID: 'client-1',
  GITHUB_CLIENT_SECRET: CANARIES.clientSecret,
  VAULT_KEY: vaultKey,
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** GitHub, answering only the real code and token. A failing GitHub echoes what it was sent, as some do. */
function fakeGitHub(failing: boolean): typeof fetch {
  return (input, init) => {
    const url = input as string;
    if (failing) {
      return Promise.resolve(
        json(
          {
            error: `rejected ${new URLSearchParams(init?.body as URLSearchParams | undefined).toString()} at ${url}`,
          },
          500,
        ),
      );
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = init?.body as URLSearchParams;
      return Promise.resolve(
        body.get('code') === CANARIES.code
          ? json({ access_token: CANARIES.githubToken })
          : json({ error: 'bad_verification_code' }),
      );
    }
    if (url === 'https://api.github.com/user') {
      return Promise.resolve(json({ id: 7, login: 'ada', name: 'Ada' }));
    }
    return Promise.resolve(json([{ email: EMAIL, primary: true, verified: true }]));
  };
}

let db: Database;
let logged: string[];
let consoleOutput: string[];
let bodies: string[];

beforeEach(async () => {
  db = await migratedDatabase();
  logged = [];
  bodies = [];
  consoleOutput = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  }
  await db.query("insert into sign_in_allowlist (email, role) values ($1, 'admin')", [EMAIL]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function api(options: { failingGitHub?: boolean; database?: () => Database } = {}) {
  return createApi({
    database: options.database ?? (() => db),
    fetch: fakeGitHub(options.failingGitHub ?? false),
    log: (message) => logged.push(message),
  });
}

/** Sends a request and keeps the response's body and headers (except Set-Cookie, which carries our own tokens). */
async function send(
  path: string,
  init: RequestInit = {},
  options: Parameters<typeof api>[0] = {},
  bindings: Record<string, string> = env,
): Promise<Response> {
  const response = await api(options).request(`${APP}${path}`, init, bindings);
  const copy = response.clone();
  const headers = [...copy.headers.entries()].filter(([name]) => name !== 'set-cookie');
  bodies.push(`${String(copy.status)} ${JSON.stringify(headers)} ${await copy.text()}`);
  return response;
}

async function signIn(options: Parameters<typeof api>[0] = {}): Promise<string | undefined> {
  const start = await send('/api/auth/github', {}, options);
  const oauth = start.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  const state = oauth.split('.')[1] ?? '';
  const callback = await send(
    `/api/auth/callback/github?code=${CANARIES.code}&state=${state}`,
    { headers: { cookie: oauth } },
    options,
  );
  return callback.headers
    .getSetCookie()
    .find((line) => line.startsWith('__Host-fc_session=') && !line.includes('Max-Age=0'))
    ?.split(';')[0];
}

describe('nothing private leaks, anywhere in the API', () => {
  it('through the whole flow, including failures', async () => {
    const session = await signIn();
    if (session === undefined) throw new Error('sign-in failed');
    const write = (method: string, body: unknown) => ({
      method,
      headers: { cookie: session, origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const created = await send('/api/projects', write('POST', { name: 'Rallly', repoUrl: '' }));
    const { project } = (await created.json()) as { project: { id: string } };
    const secrets = `/api/projects/${project.id}/secrets`;

    expect(
      (await send(`${secrets}/STRIPE_KEY`, write('PUT', { value: CANARIES.secretValue }))).status,
    ).toBe(201);
    await send(`${secrets}/STRIPE_KEY`, write('PUT', { value: CANARIES.rotatedValue }));
    await send(secrets, { headers: { cookie: session } });
    await send('/api/projects', { headers: { cookie: session } });
    await send('/api/usage', { headers: { cookie: session } });
    await send('/api/admin', { headers: { cookie: session } });
    await send('/api/me', { headers: { cookie: session } });

    // Failures: no vault key, a bad name with a value, an oversized value, the database gone, GitHub failing.
    await send(
      `${secrets}/OTHER`,
      write('PUT', { value: CANARIES.secretValue }),
      {},
      { ...env, VAULT_KEY: '' },
    );
    await send(`${secrets}/bad-name`, write('PUT', { value: CANARIES.secretValue }));
    await send(
      `${secrets}/BIG`,
      write('PUT', { value: `${CANARIES.secretValue}${'x'.repeat(70_000)}` }),
    );
    const outage = () => ({
      query: () => Promise.reject(new Error(`connection to ${env.DATABASE_URL} failed`)),
    });
    for (const path of [
      '/api/projects',
      secrets,
      '/api/usage',
      '/api/admin',
      '/api/me',
      '/api/db/ping',
    ]) {
      await send(path, { headers: { cookie: session } }, { database: outage });
    }
    await send(`${secrets}/STRIPE_KEY`, write('PUT', { value: CANARIES.secretValue }), {
      database: outage,
    });
    expect(await signIn({ failingGitHub: true })).toBeUndefined();

    await send('/api/auth/sign-out', { method: 'POST', headers: { cookie: session, origin: APP } });

    // Something was logged (the failures), so the check below is meaningful.
    expect(logged.length).toBeGreaterThan(5);
    const everything = {
      logs: logged.join('\n'),
      console: consoleOutput.join('\n'),
      responses: bodies.join('\n'),
    };
    for (const [where, text] of Object.entries(everything)) {
      for (const [name, canary] of Object.entries(CANARIES)) {
        expect(text, `${name} in ${where}`).not.toContain(canary);
      }
    }
    // Logs name people by user ID, never by email.
    expect(everything.logs).not.toContain(EMAIL);
    expect(everything.console).not.toContain(EMAIL);
  });
});
