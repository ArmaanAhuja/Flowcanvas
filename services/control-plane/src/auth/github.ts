/**
 * GitHub's OAuth web flow, as far as sign-in needs it: send the user to GitHub, swap the returned code for a
 * token, read who they are, then forget the token. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 */

export interface GitHubProfile {
  readonly id: string;
  readonly login: string;
  readonly name: string;
  readonly avatarUrl: string | undefined;
  /** The account's primary email, only if GitHub has verified it. */
  readonly verifiedEmail: string | undefined;
}

/** Thrown when GitHub answers in a way sign-in can't use. The message never contains a code or token. */
export class GitHubError extends Error {
  override readonly name = 'GitHubError';
}

// `read:user` for the profile, `user:email` for private addresses; nothing that reaches repositories.
const SCOPES = 'read:user user:email';
// GitHub's API rejects requests without a User-Agent.
const USER_AGENT = 'Flowcanvas';

export function authorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: SCOPES,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    // Never offer "sign up for GitHub" in the middle of signing in to Flowcanvas.
    allow_signup: 'false',
    // Show GitHub's account picker when several accounts are signed in, instead of using one silently.
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
  const response = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    }),
  });
  if (!response.ok) throw new GitHubError(`token exchange answered ${String(response.status)}`);
  // GitHub reports a bad code as 200 with an `error` field.
  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    const reason = typeof body.error === 'string' ? body.error : 'no access_token';
    throw new GitHubError(`token exchange failed: ${reason.slice(0, 60)}`);
  }
  return body.access_token;
}

async function getJson(fetcher: typeof fetch, token: string, path: string): Promise<unknown> {
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new GitHubError(`GET ${path} answered ${String(response.status)}`);
  return response.json();
}

interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatar_url?: string;
}

interface GitHubEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export async function fetchProfile(fetcher: typeof fetch, token: string): Promise<GitHubProfile> {
  const user = (await getJson(fetcher, token, '/user')) as GitHubUser;
  const emails = (await getJson(fetcher, token, '/user/emails')) as readonly GitHubEmail[];
  if (typeof user.id !== 'number' || typeof user.login !== 'string') {
    throw new GitHubError('unexpected /user response');
  }
  // Only the primary address, and only once verified: it's what the allowlist is checked against.
  const primary = emails.find((entry) => entry.primary && entry.verified);
  const name = user.name?.trim();
  return {
    id: String(user.id),
    login: user.login,
    name: name !== undefined && name !== '' ? name : user.login,
    avatarUrl: user.avatar_url?.startsWith('https://') === true ? user.avatar_url : undefined,
    verifiedEmail: primary?.email.toLowerCase(),
  };
}
