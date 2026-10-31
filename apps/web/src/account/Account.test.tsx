import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAGING_URL } from '../links';
import { Account } from './Account';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const ada = { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role: 'admin' };

/** A fake API: answers /api/me from `me()`, and sign-out with `signOutStatus`. */
function api(me: () => Response, signOutStatus = 204) {
  return vi.fn<typeof fetch>((input) =>
    Promise.resolve(
      input === '/api/auth/sign-out' ? new Response(null, { status: signOutStatus }) : me(),
    ),
  );
}

function renderAccount(fetcher: typeof fetch) {
  return render(
    <dl>
      <Account fetcher={fetcher} />
    </dl>,
  );
}

describe('Account', () => {
  it('offers GitHub and Google sign-in where sign-in works', async () => {
    renderAccount(
      api(() =>
        Response.json({ user: null, signIn: 'available', providers: ['github', 'google'] }),
      ),
    );
    const github = await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(github.getAttribute('href')).toBe('/api/auth/github');
    const google = screen.getByRole('link', { name: 'Sign in with Google' });
    expect(google.getAttribute('href')).toBe('/api/auth/google');
  });

  it('offers only the providers this copy has keys for', async () => {
    renderAccount(
      api(() => Response.json({ user: null, signIn: 'available', providers: ['google'] })),
    );
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in with GitHub' })).toBeNull();
  });

  it('sends people on previews to staging', async () => {
    renderAccount(api(() => Response.json({ user: null, signIn: 'staging-only' })));
    const link = await screen.findByRole('link', { name: 'staging' });
    expect(link.getAttribute('href')).toBe(STAGING_URL);
  });

  it('says plainly when sign-in isn’t set up', async () => {
    renderAccount(api(() => Response.json({ user: null, signIn: 'not-configured' })));
    expect(await screen.findByText('Sign-in isn’t set up on this copy.')).toBeTruthy();
  });

  it('says plainly when there is no API (for example vite preview)', async () => {
    renderAccount(api(() => new Response('<!doctype html>', { status: 404 })));
    expect(await screen.findByText(/the API didn’t answer/)).toBeTruthy();
  });

  it('shows who is signed in, and signs out', async () => {
    let signedIn = true;
    const fetcher = api(() =>
      Response.json(
        signedIn
          ? { user: ada, signIn: 'available', providers: ['github', 'google'] }
          : { user: null, signIn: 'available', providers: ['github', 'google'] },
      ),
    );
    renderAccount(fetcher);
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByText('ada@example.com · admin')).toBeTruthy();

    signedIn = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(fetcher).toHaveBeenCalledWith('/api/auth/sign-out', { method: 'POST' });
    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toBeTruthy();
  });

  it('says so when signing out fails, and stays signed in', async () => {
    renderAccount(
      api(
        () => Response.json({ user: ada, signIn: 'available', providers: ['github', 'google'] }),
        503,
      ),
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('status')).textContent).toBe('Couldn’t sign out. Try again.');
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('explains why sign-in came back without a session, then removes it from the address', async () => {
    window.history.replaceState(null, '', '/?sign-in=not-allowed&tab=1');
    renderAccount(
      api(() =>
        Response.json({ user: null, signIn: 'available', providers: ['github', 'google'] }),
      ),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'That account’s email (on GitHub, its primary email) isn’t on the Flowcanvas allowlist yet. Ask the admin to add it.',
    );
    expect(window.location.pathname + window.location.search).toBe('/?tab=1');
    await screen.findByRole('link', { name: 'Sign in with GitHub' });
  });

  it('treats an unknown problem code as a generic failure, never echoing it', async () => {
    window.history.replaceState(null, '', '/?sign-in=%3Cscript%3E');
    renderAccount(
      api(() =>
        Response.json({ user: null, signIn: 'available', providers: ['github', 'google'] }),
      ),
    );
    expect(screen.getByRole('status').textContent).toBe('Sign-in failed. Try again in a moment.');
    await screen.findByRole('link', { name: 'Sign in with GitHub' });
  });
});
