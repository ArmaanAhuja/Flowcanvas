import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Database } from '../db/database.js';
import { describeError } from '../api/redact.js';
import { cookieBase, OAUTH_COOKIE, SESSION_COOKIE } from './cookies.js';
import { createSession, endSession, SESSION_DAYS, sessionUser, signIn } from './accounts.js';
import { requireSameOrigin } from './guards.js';
import { constantTimeEqual, pkceChallenge, randomToken } from './crypto.js';
import { findProvider, PROVIDERS, type ProviderBindings, type ProviderId } from './providers.js';

/** Worker secrets and variables sign-in reads. `.dev.vars` and `wrangler dev --var` set them locally. */
export interface AuthBindings extends ProviderBindings {
  readonly DATABASE_URL?: string;
  /** The one address sign-in works on (staging, or http://localhost:5173 locally); see `signInState`. */
  readonly APP_ORIGIN?: string;
  /** The secrets vault's master key (32 random bytes, base64); see src/vault/crypto.ts. */
  readonly VAULT_KEY?: string;
}

export interface AuthDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly fetch: typeof fetch;
  readonly log: (message: string) => void;
}

/**
 * Whether this copy of the app can sign people in:
 * - `available`: this is the address registered with GitHub and Google (staging, or local development)
 * - `staging-only`: a branch preview; providers only return to registered addresses (decisions log, 30 Oct 2026)
 * - `not-configured`: the database, APP_ORIGIN or every provider's keys are missing
 */
export type SignInState = 'available' | 'staging-only' | 'not-configured';

/** Why sign-in came back to the app without a session; the app shows a message for each. */
export type SignInProblem =
  'cancelled' | 'expired' | 'no-verified-email' | 'not-allowed' | 'unavailable' | 'failed';

type AuthContext = Context<{ Bindings: AuthBindings }>;

/** Providers whose client ID and secret are both set. */
function configuredProviders(env: AuthBindings): ProviderId[] {
  return PROVIDERS.filter((provider) => provider.keys(env) !== undefined).map(({ id }) => id);
}

function signInState(c: AuthContext): SignInState {
  const { DATABASE_URL, APP_ORIGIN } = c.env;
  if (!DATABASE_URL || !APP_ORIGIN || configuredProviders(c.env).length === 0) {
    return 'not-configured';
  }
  return new URL(c.req.url).origin === APP_ORIGIN ? 'available' : 'staging-only';
}

function backToApp(c: AuthContext, problem?: SignInProblem): Response {
  return c.redirect(problem === undefined ? '/' : `/?sign-in=${problem}`, 302);
}

const callbackUrl = (c: AuthContext, provider: ProviderId) =>
  `${c.env.APP_ORIGIN ?? ''}/api/auth/callback/${provider}`;

export function authRoutes(deps: AuthDependencies) {
  const auth = new Hono<{ Bindings: AuthBindings }>();

  auth.get('/me', async (c) => {
    const state = signInState(c);
    const answer = { signIn: state, providers: configuredProviders(c.env) };
    const token = getCookie(c, SESSION_COOKIE, 'host');
    const databaseUrl = c.env.DATABASE_URL;
    if (token === undefined || !databaseUrl) return c.json({ user: null, ...answer });
    try {
      const user = await sessionUser(deps.database(databaseUrl), token);
      if (user === undefined) deleteCookie(c, SESSION_COOKIE, cookieBase);
      return c.json({ user: user ?? null, ...answer });
    } catch (error) {
      deps.log(`session lookup failed: ${describeError(error)}`);
      return c.json({ error: 'Could not check your session. Try again in a moment.' }, 503);
    }
  });

  // Step 1: remember which provider, a one-time state and a PKCE verifier, then send the browser to the provider.
  auth.get('/auth/:provider', async (c) => {
    const provider = findProvider(c.req.param('provider'));
    if (provider === undefined) return c.json({ error: 'not found' }, 404);
    const keys = provider.keys(c.env);
    if (signInState(c) !== 'available' || keys === undefined) return backToApp(c, 'unavailable');

    const state = randomToken();
    const verifier = randomToken();
    setCookie(c, OAUTH_COOKIE, `${provider.id}.${state}.${verifier}`, {
      ...cookieBase,
      maxAge: 600,
    });
    return c.redirect(
      provider.authorizeUrl({
        clientId: keys.clientId,
        redirectUri: callbackUrl(c, provider.id),
        state,
        codeChallenge: await pkceChallenge(verifier),
      }),
      302,
    );
  });

  // Step 2: the provider sends the browser back with a code. Check it's the sign-in we started, then who it is.
  auth.get('/auth/callback/:provider', async (c) => {
    const started = getCookie(c, OAUTH_COOKIE, 'host');
    deleteCookie(c, OAUTH_COOKIE, cookieBase);
    const provider = findProvider(c.req.param('provider'));
    if (provider === undefined) return c.json({ error: 'not found' }, 404);
    const keys = provider.keys(c.env);
    if (signInState(c) !== 'available' || keys === undefined) return backToApp(c, 'unavailable');
    if (c.req.query('error') === 'access_denied') return backToApp(c, 'cancelled');

    const [startedWith, expectedState, verifier] = started?.split('.') ?? [];
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (
      startedWith !== provider.id ||
      expectedState === undefined ||
      verifier === undefined ||
      state === undefined ||
      code === undefined ||
      !constantTimeEqual(state, expectedState)
    ) {
      return backToApp(c, 'expired');
    }

    try {
      const identity = await provider.identify(deps.fetch, {
        ...keys,
        code,
        redirectUri: callbackUrl(c, provider.id),
        codeVerifier: verifier,
      });
      if (identity === 'no-verified-email') return backToApp(c, 'no-verified-email');

      const db = deps.database(c.env.DATABASE_URL ?? '');
      const result = await signIn(db, identity);
      if (result.kind === 'not-allowed') return backToApp(c, 'not-allowed');

      // A fresh token on every sign-in, and the previous session in this browser ends.
      const previous = getCookie(c, SESSION_COOKIE, 'host');
      if (previous !== undefined) await endSession(db, previous);
      const token = await createSession(db, result.userId, c.req.header('user-agent'));
      setCookie(c, SESSION_COOKIE, token, { ...cookieBase, maxAge: SESSION_DAYS * 24 * 60 * 60 });
      return backToApp(c);
    } catch (error) {
      deps.log(`${provider.id} sign-in failed: ${describeError(error)}`);
      return backToApp(c, 'failed');
    }
  });

  auth.post('/auth/sign-out', requireSameOrigin, async (c) => {
    const token = getCookie(c, SESSION_COOKIE, 'host');
    deleteCookie(c, SESSION_COOKIE, cookieBase);
    if (token !== undefined && c.env.DATABASE_URL) {
      try {
        await endSession(deps.database(c.env.DATABASE_URL), token);
      } catch (error) {
        deps.log(`sign-out failed: ${describeError(error)}`);
        return c.json({ error: 'Could not end the session on the server. Try again.' }, 503);
      }
    }
    return c.body(null, 204);
  });

  return auth;
}
