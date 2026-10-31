import type { VerifiedIdentity } from './accounts.js';
import * as github from './github.js';
import * as google from './google.js';

export type ProviderId = 'github' | 'google';

/** Worker secrets holding each provider's OAuth client. */
export interface ProviderBindings {
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
}

export interface ProviderKeys {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** What the sign-in routes need from GitHub or Google. Everything else (state, PKCE, allowlist, session) is shared. */
export interface OAuthProvider {
  readonly id: ProviderId;
  /** This provider's client ID and secret, or undefined when either secret is missing. */
  readonly keys: (env: ProviderBindings) => ProviderKeys | undefined;
  readonly authorizeUrl: (options: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly codeChallenge: string;
  }) => string;
  /**
   * Swaps the code for the provider's token and reads who signed in. The token never leaves this function:
   * it isn't stored or logged. `no-verified-email` when the provider hasn't verified the person's email.
   */
  readonly identify: (
    fetcher: typeof fetch,
    exchange: ProviderKeys & {
      readonly code: string;
      readonly redirectUri: string;
      readonly codeVerifier: string;
    },
  ) => Promise<VerifiedIdentity | 'no-verified-email'>;
}

function keys(clientId: string | undefined, clientSecret: string | undefined) {
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

const githubProvider: OAuthProvider = {
  id: 'github',
  keys: (env) => keys(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
  authorizeUrl: github.authorizeUrl,
  identify: async (fetcher, exchange) => {
    const profile = await github.fetchProfile(
      fetcher,
      await github.exchangeCode(fetcher, exchange),
    );
    if (profile.verifiedEmail === undefined) return 'no-verified-email';
    return {
      provider: 'github',
      providerUserId: profile.id,
      username: profile.login,
      email: profile.verifiedEmail,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
    };
  },
};

const googleProvider: OAuthProvider = {
  id: 'google',
  keys: (env) => keys(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  authorizeUrl: google.authorizeUrl,
  identify: async (fetcher, exchange) => {
    const profile = await google.fetchProfile(
      fetcher,
      await google.exchangeCode(fetcher, exchange),
    );
    if (profile.verifiedEmail === undefined) return 'no-verified-email';
    return {
      provider: 'google',
      providerUserId: profile.id,
      username: undefined,
      email: profile.verifiedEmail,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
    };
  },
};

/** In the order the sign-in buttons appear. */
export const PROVIDERS: readonly OAuthProvider[] = [githubProvider, googleProvider];

export function findProvider(id: string): OAuthProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
