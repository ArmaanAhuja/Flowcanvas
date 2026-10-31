// The whole sign-in through the API: fake GitHub and Google, real SQL (PGlite), real cookies.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { pkceChallenge } from './crypto.js';

const APP = 'https://flowcanvas.example.workers.dev';
const PREVIEW = 'https://phase-x-flowcanvas.example.workers.dev';
// Canaries: none of these may ever appear in a log line or a response body.
const CLIENT_SECRET = 'CANARY-client-secret';
const GITHUB_TOKEN = 'gho_CANARY-github-token';
const GOOGLE_SECRET = 'GOCSPX-CANARY-google-secret';
const GOOGLE_TOKEN = 'ya29.CANARY-google-token';
const CODE = 'CANARY-code';

const env = {
  DATABASE_URL: 'postgresql://unused-by-the-fake-database',
  GITHUB_CLIENT_ID: 'client-1',
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_CLIENT_ID: 'google-client-1.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
  APP_ORIGIN: APP,
};

let db: Database;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let githubUser: { id: number; login: string; name: string | null };
let githubEmails: { email: string; primary: boolean; verified: boolean }[];
let tokenExchange: ReturnType<typeof vi.fn<(body: URLSearchParams) => Response>>;
let googleUserinfo: Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Answers like GitHub and Google for the calls sign-in makes.
// The code under test always calls fetch with a string URL and a URLSearchParams body.
function answer(url: string, init: RequestInit | undefined): Response {
  if (url === 'https://github.com/login/oauth/access_token') {
    return tokenExchange(init?.body as URLSearchParams);
  }
  const authorization = new Headers(init?.headers).get('authorization');
  if (url === 'https://oauth2.googleapis.com/token') {
    const body = init?.body as URLSearchParams;
    return body.get('client_secret') === GOOGLE_SECRET &&
      body.get('code') === CODE &&
      body.get('grant_type') === 'authorization_code'
      ? json({ access_token: GOOGLE_TOKEN, id_token: 'unused' })
      : json({ error: 'invalid_grant' }, 400);
  }
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
    return authorization === `Bearer ${GOOGLE_TOKEN}`
      ? json(googleUserinfo)
      : json({ error: 'invalid_token' }, 401);
  }
  if (authorization !== `Bearer ${GITHUB_TOKEN}`) return json({ message: 'Bad credentials' }, 401);
  if (url === 'https://api.github.com/user') return json(githubUser);
  if (url === 'https://api.github.com/user/emails') return json(githubEmails);
  return json({ message: 'Not Found' }, 404);
}
const fakeGitHub: typeof fetch = (input, init) => Promise.resolve(answer(input as string, init));

function api() {
  return createApi({ database: () => db, fetch: fakeGitHub, log });
}

beforeEach(async () => {
  db = await migratedDatabase();
  log = vi.fn<(message: string) => void>();
  githubUser = { id: 42, login: 'ada', name: 'Ada' };
  githubEmails = [{ email: 'ada@example.com', primary: true, verified: true }];
  googleUserinfo = { sub: 'g-1', name: 'Ada G', email: 'ada@example.com', email_verified: true };
  tokenExchange = vi.fn((body: URLSearchParams) =>
    body.get('client_secret') === CLIENT_SECRET && body.get('code') === CODE
      ? json({ access_token: GITHUB_TOKEN })
      : json({ error: 'bad_verification_code' }),
  );
  await db.query("insert into sign_in_allowlist (email, role) values ('ada@example.com', 'admin')");
});

/** `name=value` pairs from Set-Cookie headers, plus the raw headers to check attributes. */
function cookies(response: Response): { values: Map<string, string>; raw: string[] } {
  const raw = response.headers.getSetCookie();
  const values = new Map(
    raw.map((line) => {
      const [pair = ''] = line.split(';');
      const index = pair.indexOf('=');
      return [pair.slice(0, index), pair.slice(index + 1)] as const;
    }),
  );
  return { values, raw };
}

async function start(origin = APP, provider = 'github') {
  const response = await api().request(`${origin}/api/auth/${provider}`, {}, env);
  const oauthCookie = cookies(response).values.get('__Host-fc_oauth') ?? '';
  const location = response.headers.get('location') ?? '';
  return { response, oauthCookie, location };
}

async function callback(query: string, cookie: string, provider = 'github') {
  return api().request(
    `${APP}/api/auth/callback/${provider}?${query}`,
    { headers: { cookie, 'user-agent': 'Vitest' } },
    env,
  );
}

/** Starts and completes a sign-in, returning the session cookie header to send back. */
async function signInAsAda(): Promise<string> {
  const { oauthCookie, location } = await start();
  const state = new URL(location).searchParams.get('state') ?? '';
  const response = await callback(`code=${CODE}&state=${state}`, `__Host-fc_oauth=${oauthCookie}`);
  expect(response.headers.get('location')).toBe('/');
  return `__Host-fc_session=${cookies(response).values.get('__Host-fc_session') ?? ''}`;
}

async function me(cookie?: string, origin = APP) {
  const response = await api().request(
    `${origin}/api/me`,
    cookie ? { headers: { cookie } } : {},
    env,
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('sign-in availability', () => {
  it('is available on the registered address', async () => {
    expect((await me()).body).toEqual({
      user: null,
      signIn: 'available',
      providers: ['github', 'google'],
    });
  });

  it('points branch previews to staging', async () => {
    expect((await me(undefined, PREVIEW)).body).toMatchObject({ signIn: 'staging-only' });
    const { response } = await start(PREVIEW);
    expect(response.headers.get('location')).toBe('/?sign-in=unavailable');
  });

  it('offers only providers whose ID and secret are both set', async () => {
    const response = await api().request(`${APP}/api/me`, {}, { ...env, GITHUB_CLIENT_SECRET: '' });
    expect(await response.json()).toEqual({
      user: null,
      signIn: 'available',
      providers: ['google'],
    });
    const github = await api().request(
      `${APP}/api/auth/github`,
      {},
      { ...env, GITHUB_CLIENT_ID: '' },
    );
    expect(github.headers.get('location')).toBe('/?sign-in=unavailable');
  });

  it('says when nothing is configured', async () => {
    const response = await api().request(
      `${APP}/api/me`,
      {},
      { ...env, GITHUB_CLIENT_SECRET: '', GOOGLE_CLIENT_ID: '' },
    );
    expect(await response.json()).toEqual({ user: null, signIn: 'not-configured', providers: [] });
  });

  it('knows only GitHub and Google', async () => {
    const response = await api().request(`${APP}/api/auth/gitlab`, {}, env);
    expect(response.status).toBe(404);
  });

  it('is never cached', async () => {
    expect((await me()).response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GitHub sign-in', () => {
  it('sends the browser to GitHub with a state and a PKCE challenge it remembers in a __Host- cookie', async () => {
    const { response, oauthCookie, location } = await start();
    expect(response.status).toBe(302);
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/callback/github`);

    const [provider, state, verifier = ''] = oauthCookie.split('.');
    expect(provider).toBe('github');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(verifier));
    expect(cookies(response).raw[0]).toMatch(
      /^__Host-fc_oauth=.*; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('signs in, sets a session cookie and answers /api/me with the user', async () => {
    const { oauthCookie, location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(
      `code=${CODE}&state=${state}`,
      `__Host-fc_oauth=${oauthCookie}`,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const set = cookies(response);
    expect(set.raw.find((line) => line.startsWith('__Host-fc_session='))).toMatch(
      /; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    // The one-time sign-in cookie is cleared.
    expect(set.raw.find((line) => line.startsWith('__Host-fc_oauth='))).toMatch(/Max-Age=0/);
    expect(tokenExchange.mock.calls[0]?.[0].get('code_verifier')).toBe(oauthCookie.split('.')[2]);

    const session = `__Host-fc_session=${set.values.get('__Host-fc_session') ?? ''}`;
    const { body } = await me(session);
    expect(body).toEqual({
      user: {
        id: expect.any(String) as string,
        email: 'ada@example.com',
        displayName: 'Ada',
        role: 'admin',
      },
      signIn: 'available',
      providers: ['github', 'google'],
    });
  });

  it('refuses a state that doesn’t match the one it sent', async () => {
    const { oauthCookie } = await start();
    const response = await callback(`code=${CODE}&state=forged`, `__Host-fc_oauth=${oauthCookie}`);
    expect(response.headers.get('location')).toBe('/?sign-in=expired');
    expect(tokenExchange).not.toHaveBeenCalled();
  });

  it('refuses a callback without the sign-in cookie (started elsewhere, or expired)', async () => {
    const { location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(`code=${CODE}&state=${state}`, '');
    expect(response.headers.get('location')).toBe('/?sign-in=expired');
  });

  it('says so when the person cancels on GitHub', async () => {
    const { oauthCookie } = await start();
    const response = await callback(
      'error=access_denied&state=x',
      `__Host-fc_oauth=${oauthCookie}`,
    );
    expect(response.headers.get('location')).toBe('/?sign-in=cancelled');
  });

  it('turns away a GitHub account whose email isn’t on the allowlist', async () => {
    githubEmails = [{ email: 'mallory@example.com', primary: true, verified: true }];
    const { oauthCookie, location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(
      `code=${CODE}&state=${state}`,
      `__Host-fc_oauth=${oauthCookie}`,
    );
    expect(response.headers.get('location')).toBe('/?sign-in=not-allowed');
    expect(cookies(response).values.has('__Host-fc_session')).toBe(false);
  });

  it('needs a verified primary email', async () => {
    githubEmails = [{ email: 'ada@example.com', primary: true, verified: false }];
    const { oauthCookie, location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(
      `code=${CODE}&state=${state}`,
      `__Host-fc_oauth=${oauthCookie}`,
    );
    expect(response.headers.get('location')).toBe('/?sign-in=no-verified-email');
  });

  it('reports a failed exchange without logging the code, the token or the client secret', async () => {
    tokenExchange.mockReturnValue(json({ error: 'bad_verification_code' }));
    const { oauthCookie, location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(
      `code=${CODE}&state=${state}`,
      `__Host-fc_oauth=${oauthCookie}`,
    );
    expect(response.headers.get('location')).toBe('/?sign-in=failed');
    const logged = log.mock.calls.flat().join('\n');
    expect(logged).toContain('bad_verification_code');
    expect(logged).not.toMatch(/CANARY/);
  });

  it('never writes the GitHub token anywhere in the database', async () => {
    await signInAsAda();
    for (const table of ['users', 'identities', 'sessions']) {
      expect(JSON.stringify(await db.query(`select * from ${table}`))).not.toMatch(/CANARY/);
    }
  });

  it('replaces the previous session when signing in again in the same browser', async () => {
    const first = await signInAsAda();
    const { oauthCookie, location } = await start();
    const state = new URL(location).searchParams.get('state') ?? '';
    await callback(`code=${CODE}&state=${state}`, `__Host-fc_oauth=${oauthCookie}; ${first}`);
    expect((await me(first)).body.user).toBeNull();
    const rows = await db.query<{ n: number }>('select count(*)::int as n from sessions');
    expect(rows[0]?.n).toBe(1);
  });
});

describe('Google sign-in', () => {
  async function googleSignIn() {
    const { oauthCookie, location } = await start(APP, 'google');
    const state = new URL(location).searchParams.get('state') ?? '';
    return callback(`code=${CODE}&state=${state}`, `__Host-fc_oauth=${oauthCookie}`, 'google');
  }

  it('sends the browser to Google with OpenID scopes, state, PKCE and the account picker', async () => {
    const { oauthCookie, location } = await start(APP, 'google');
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const [provider, state, verifier = ''] = oauthCookie.split('.');
    expect(provider).toBe('google');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'google-client-1.apps.googleusercontent.com',
      redirect_uri: `${APP}/api/auth/callback/google`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });

  it('signs in with a verified Google email', async () => {
    const response = await googleSignIn();
    expect(response.headers.get('location')).toBe('/');
    const session = `__Host-fc_session=${cookies(response).values.get('__Host-fc_session') ?? ''}`;
    expect((await me(session)).body.user).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada G',
      role: 'admin',
    });
  });

  it('lands on the same user as GitHub when the verified email is the same', async () => {
    const github = await signInAsAda();
    const google = await googleSignIn();
    const googleSession = `__Host-fc_session=${cookies(google).values.get('__Host-fc_session') ?? ''}`;
    const githubUser = (await me(github)).body.user as { id: string };
    const googleUser = (await me(googleSession)).body.user as { id: string };
    expect(googleUser.id).toBe(githubUser.id);
    const identities = await db.query<{ provider: string }>(
      'select provider from identities order by provider',
    );
    expect(identities).toEqual([{ provider: 'github' }, { provider: 'google' }]);
  });

  it('needs Google to have verified the email', async () => {
    googleUserinfo = { ...googleUserinfo, email_verified: false };
    expect((await googleSignIn()).headers.get('location')).toBe('/?sign-in=no-verified-email');
  });

  it('turns away a Google account whose email isn’t on the allowlist', async () => {
    googleUserinfo = { ...googleUserinfo, email: 'mallory@example.com' };
    expect((await googleSignIn()).headers.get('location')).toBe('/?sign-in=not-allowed');
  });

  it('refuses a callback for a different provider than the one the sign-in started with', async () => {
    const { oauthCookie, location } = await start(APP, 'github');
    const state = new URL(location).searchParams.get('state') ?? '';
    const response = await callback(
      `code=${CODE}&state=${state}`,
      `__Host-fc_oauth=${oauthCookie}`,
      'google',
    );
    expect(response.headers.get('location')).toBe('/?sign-in=expired');
  });

  it('never logs Google’s secret, code or token when sign-in fails', async () => {
    googleUserinfo = {};
    expect((await googleSignIn()).headers.get('location')).toBe('/?sign-in=failed');
    const logged = log.mock.calls.flat().join('\n');
    expect(logged).toContain('google sign-in failed');
    expect(logged).not.toMatch(/CANARY/);
  });
});

describe('sign out', () => {
  it('only accepts requests from Flowcanvas itself', async () => {
    const session = await signInAsAda();
    const response = await api().request(
      `${APP}/api/auth/sign-out`,
      { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } },
      env,
    );
    expect(response.status).toBe(403);
    expect((await me(session)).body.user).not.toBeNull();
  });

  it('ends the session and clears the cookie', async () => {
    const session = await signInAsAda();
    const response = await api().request(
      `${APP}/api/auth/sign-out`,
      { method: 'POST', headers: { cookie: session, origin: APP } },
      env,
    );
    expect(response.status).toBe(204);
    expect(cookies(response).raw[0]).toMatch(/^__Host-fc_session=; Max-Age=0/);
    expect((await me(session)).body.user).toBeNull();
  });
});
