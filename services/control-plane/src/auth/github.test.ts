import { describe, expect, it, vi } from 'vitest';
import { authorizeUrl, exchangeCode, fetchProfile, GitHubError } from './github.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('authorizeUrl', () => {
  it('asks only for profile and email, with state and a PKCE challenge', () => {
    const url = new URL(
      authorizeUrl({
        clientId: 'client-1',
        redirectUri: 'http://localhost:5173/api/auth/callback/github',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'http://localhost:5173/api/auth/callback/github',
      scope: 'read:user user:email',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      allow_signup: 'false',
      prompt: 'select_account',
    });
  });
});

describe('exchangeCode', () => {
  const options = {
    clientId: 'client-1',
    clientSecret: 'CANARY-CLIENT-SECRET',
    code: 'CANARY-CODE',
    redirectUri: 'http://localhost:5173/api/auth/callback/github',
    codeVerifier: 'verifier-1',
  };

  it('sends the code with its PKCE verifier and returns the token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'gho_token' }));
    expect(await exchangeCode(fetcher, options)).toBe('gho_token');
    // exchangeCode sends a URLSearchParams body.
    const body = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('code')).toBe('CANARY-CODE');
    expect(body.get('code_verifier')).toBe('verifier-1');
  });

  it('turns GitHub’s 200-with-error into an error that names the reason, not the code', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: 'bad_verification_code' }));
    const failure = exchangeCode(fetcher, options);
    await expect(failure).rejects.toThrow(GitHubError);
    await expect(failure).rejects.toThrow('token exchange failed: bad_verification_code');
    await expect(failure).rejects.not.toThrow(/CANARY/);
  });
});

describe('fetchProfile', () => {
  function github(emails: unknown, user: unknown = { id: 42, login: 'ada', name: 'Ada' }) {
    return vi.fn<typeof fetch>((input) =>
      Promise.resolve((input as string).endsWith('/user/emails') ? json(emails) : json(user)),
    );
  }

  it('uses the primary verified email, lower-cased', async () => {
    const profile = await fetchProfile(
      github([
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'Ada@Example.com', primary: true, verified: true },
      ]),
      'gho_token',
    );
    expect(profile).toEqual({
      id: '42',
      login: 'ada',
      name: 'Ada',
      avatarUrl: undefined,
      verifiedEmail: 'ada@example.com',
    });
  });

  it('has no email when the primary one is unverified', async () => {
    const profile = await fetchProfile(
      github([{ email: 'ada@example.com', primary: true, verified: false }]),
      'gho_token',
    );
    expect(profile.verifiedEmail).toBeUndefined();
  });

  it('falls back to the login when there is no name', async () => {
    const profile = await fetchProfile(
      github([], { id: 7, login: 'grace', name: null, avatar_url: 'https://avatars.example/7' }),
      'gho_token',
    );
    expect(profile.name).toBe('grace');
    expect(profile.avatarUrl).toBe('https://avatars.example/7');
  });

  it('fails clearly when GitHub refuses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 401));
    await expect(fetchProfile(fetcher, 'gho_token')).rejects.toThrow('GET /user answered 401');
  });
});
