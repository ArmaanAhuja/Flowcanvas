// `__Host-` cookies (RFC 6265bis): Secure, Path=/, no Domain, so no other site or subdomain can set or read them.
export const SESSION_COOKIE = 'fc_session';
/** Which provider a sign-in started with, its state and its PKCE verifier; lives 10 minutes. */
export const OAUTH_COOKIE = 'fc_oauth';

export const cookieBase = {
  prefix: 'host',
  secure: true,
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
} as const;
