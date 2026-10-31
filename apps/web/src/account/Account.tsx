import { useEffect, useState } from 'react';
import { STAGING_URL } from '../links';
import styles from './Account.module.css';
import { loadSession, PROVIDERS, signOut, takeSignInProblem, type Session } from './session';

interface AccountProps {
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
  /** Told whenever the session is loaded or ends, so the page can show what needs a signed-in person. */
  readonly onSessionChange?: (session: Session) => void;
}

/** The "Account" row of the version page: who is signed in, or how to sign in here. Renders a <dt>/<dd> pair. */
export function Account({ fetcher = fetch, onSessionChange }: AccountProps) {
  const [session, setSession] = useState<Session | undefined>(undefined);

  useEffect(() => {
    if (session !== undefined) onSessionChange?.(session);
  }, [session, onSessionChange]);
  const [message, setMessage] = useState<string | undefined>(() =>
    takeSignInProblem(window.location, window.history),
  );

  useEffect(() => {
    let current = true;
    void loadSession(fetcher).then((loaded) => {
      if (current) setSession(loaded);
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  async function handleSignOut(): Promise<void> {
    if (await signOut(fetcher)) {
      setSession(await loadSession(fetcher));
      setMessage(undefined);
    } else {
      setMessage('Couldn’t sign out. Try again.');
    }
  }

  return (
    <>
      <dt className={styles.term}>Account</dt>
      <dd className={styles.value}>
        {/* Nothing until the API answers, so the row never flickers from "signed out" to signed in. */}
        {session !== undefined && <AccountState session={session} onSignOut={handleSignOut} />}
        {message !== undefined && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}
      </dd>
    </>
  );
}

function AccountState({
  session,
  onSignOut,
}: {
  readonly session: Session;
  readonly onSignOut: () => Promise<void>;
}) {
  if (session.kind === 'signed-in') {
    const { displayName, email, role } = session.user;
    return (
      <span className={styles.row}>
        <span className={styles.name}>{displayName}</span>
        <span className={styles.detail}>
          {email}
          {role === 'admin' ? ' · admin' : ''}
        </span>
        {/* A text button like the sign-in links, so it lines up with the text around it. */}
        <button type="button" className={styles.textButton} onClick={() => void onSignOut()}>
          Sign out
        </button>
      </span>
    );
  }
  switch (session.signIn) {
    case 'available':
      return (
        <span className={styles.row}>
          {session.providers.map((id) => (
            <a key={id} className={styles.link} href={PROVIDERS[id].path}>
              {PROVIDERS[id].label}
            </a>
          ))}
        </span>
      );
    case 'staging-only':
      // Branch previews have their own addresses, which GitHub won't return to (decisions log, 30 Oct 2026).
      return (
        <span className={styles.detail}>
          Sign-in works on{' '}
          <a className={styles.link} href={STAGING_URL}>
            staging
          </a>
          , not on previews.
        </span>
      );
    case 'not-configured':
      return <span className={styles.detail}>Sign-in isn’t set up on this copy.</span>;
    case 'unreachable':
      return <span className={styles.detail}>Sign-in is unavailable: the API didn’t answer.</span>;
  }
}
