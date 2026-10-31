import { describe, expect, it, vi } from 'vitest';
import { exchangeCode, fetchProfile, GoogleError } from './google.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Google exchangeCode', () => {
  const options = {
    clientId: 'client-1',
    clientSecret: 'GOCSPX-CANARY',
    code: 'CANARY-CODE',
    redirectUri: 'http://localhost:5173/api/auth/callback/google',
    codeVerifier: 'verifier-1',
  };

  it('sends an authorization_code grant with the PKCE verifier', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'ya29.token' }));
    expect(await exchangeCode(fetcher, options)).toBe('ya29.token');
    const body = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verifier-1');
  });

  it('names Google’s error, never the code or secret', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'invalid_grant' }, 400));
    const failure = exchangeCode(fetcher, options);
    await expect(failure).rejects.toThrow(GoogleError);
    await expect(failure).rejects.toThrow('token exchange failed: invalid_grant');
    await expect(failure).rejects.not.toThrow(/CANARY/);
  });
});

describe('Google fetchProfile', () => {
  const google = (info: unknown) => vi.fn<typeof fetch>().mockResolvedValue(json(info));

  it('reads a verified email, lower-cased', async () => {
    const profile = await fetchProfile(
      google({ sub: '1', name: 'Ada', email: 'Ada@Example.com', email_verified: true }),
      'ya29.token',
    );
    expect(profile).toEqual({
      id: '1',
      name: 'Ada',
      avatarUrl: undefined,
      verifiedEmail: 'ada@example.com',
    });
  });

  it('has no email unless Google verified it', async () => {
    const profile = await fetchProfile(
      google({ sub: '1', email: 'ada@example.com', email_verified: false }),
      'ya29.token',
    );
    expect(profile.verifiedEmail).toBeUndefined();
  });

  it('falls back to the email’s name part when there is no name', async () => {
    const profile = await fetchProfile(
      google({ sub: '1', email: 'grace@example.com', email_verified: true }),
      'ya29.token',
    );
    expect(profile.name).toBe('grace');
  });

  it('fails clearly without a subject', async () => {
    await expect(fetchProfile(google({ email: 'x@example.com' }), 'ya29.token')).rejects.toThrow(
      'unexpected userinfo response',
    );
  });
});
