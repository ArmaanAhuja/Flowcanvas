/**
 * Google sign-in (OpenID Connect, authorization code flow with PKCE), as far as sign-in needs it: send the user to
 * Google, swap the returned code for a token, read who they are from the userinfo endpoint, then forget the token.
 * Reading userinfo over TLS with the fresh token means there's no ID token to verify ourselves.
 * https://developers.google.com/identity/openid-connect/openid-connect
 */

export interface GoogleProfile {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | undefined;
  /** The account's email, only if Google says it's verified. */
  readonly verifiedEmail: string | undefined;
}

/** Thrown when Google answers in a way sign-in can't use. The message never contains a code or token. */
export class GoogleError extends Error {
  override readonly name = 'GoogleError';
}

export function authorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    // Who you are and your email; nothing from Drive, Gmail or anything else.
    scope: 'openid email profile',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    // Always let people choose the Google account, instead of silently using the one signed in.
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  fetcher: typeof fetch,
  options: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  },
): Promise<string> {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });
  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  if (!response.ok || typeof body.access_token !== 'string' || body.access_token === '') {
    const reason =
      typeof body.error === 'string' ? body.error : `status ${String(response.status)}`;
    throw new GoogleError(`token exchange failed: ${reason.slice(0, 60)}`);
  }
  return body.access_token;
}

interface GoogleUserinfo {
  readonly sub?: unknown;
  readonly name?: unknown;
  readonly picture?: unknown;
  readonly email?: unknown;
  readonly email_verified?: unknown;
}

export async function fetchProfile(fetcher: typeof fetch, token: string): Promise<GoogleProfile> {
  const response = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new GoogleError(`userinfo answered ${String(response.status)}`);
  const info = (await response.json()) as GoogleUserinfo;
  if (typeof info.sub !== 'string' || info.sub === '') {
    throw new GoogleError('unexpected userinfo response');
  }
  const email = typeof info.email === 'string' ? info.email.toLowerCase() : undefined;
  const name = typeof info.name === 'string' ? info.name.trim() : '';
  return {
    id: info.sub,
    // Google accounts may have no name; the email's local part is a recognisable fallback.
    name: name !== '' ? name : (email?.split('@')[0] ?? 'Google user'),
    avatarUrl:
      typeof info.picture === 'string' && info.picture.startsWith('https://')
        ? info.picture
        : undefined,
    verifiedEmail: info.email_verified === true ? email : undefined,
  };
}
