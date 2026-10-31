import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import releases from 'virtual:changelog';
import { App } from './App';
import { CATALOGUE_URL } from './links';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const buildInfo = { version: '0.1.0', commit: '7e59ec1a2b3c' };
// The API's answer for nobody signed in (account/Account.test.tsx covers the other states).
const signedOut: typeof fetch = () =>
  Promise.resolve(
    Response.json({ user: null, signIn: 'available', providers: ['github', 'google'] }),
  );

describe('App', () => {
  it('shows the product name', () => {
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    expect(screen.getByRole('heading', { name: 'Flowcanvas' })).toBeTruthy();
  });

  it('shows the version and short commit it was built from', () => {
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    expect(screen.getByText('0.1.0 · 7e59ec1')).toBeTruthy();
  });

  it('offers GitHub sign-in when nobody is signed in', async () => {
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    const link = await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(link.getAttribute('href')).toBe('/api/auth/github');
  });

  /** A fake API for a signed-in person with this role. */
  const signedInAs =
    (role: 'member' | 'admin'): typeof fetch =>
    (input) =>
      Promise.resolve(
        input === '/api/me'
          ? Response.json({
              user: { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', role },
              signIn: 'available',
              providers: ['github'],
            })
          : input === '/api/usage'
            ? Response.json({
                usage: {
                  periodStart: '2026-10-01T00:00:00.000Z',
                  resetsAt: '2026-11-01T00:00:00.000Z',
                  workspaceSeconds: 0,
                  storageByteHours: 0,
                },
              })
            : input === '/api/admin'
              ? Response.json({ people: [], allowlist: [] })
              : Response.json({ projects: [] }),
      );

  it('shows projects only to a signed-in person', async () => {
    const signedIn = signedInAs('member');
    render(<App buildInfo={buildInfo} fetcher={signedIn} />);
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Usage this month' })).toBeTruthy();
    cleanup();

    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    await screen.findByRole('link', { name: 'Sign in with GitHub' });
    expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Usage this month' })).toBeNull();
  });

  it('shows the admin section to admins only', async () => {
    render(<App buildInfo={buildInfo} fetcher={signedInAs('member')} />);
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull();
    cleanup();

    render(<App buildInfo={buildInfo} fetcher={signedInAs('admin')} />);
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy();
  });

  it('links to the component catalogue', () => {
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    const link = screen.getByRole('link', { name: 'Open the component catalogue' });
    expect(link.getAttribute('href')).toBe(CATALOGUE_URL);
  });

  it('follows the system theme by default and switches theme from the menu', async () => {
    const user = userEvent.setup();
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    expect(document.documentElement.dataset.theme).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Theme: System' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeTruthy();
    expect(localStorage.getItem('flowcanvas-theme')).toBe('light');
  });

  it('marks unseen release notes, shows them on demand, then remembers they were seen', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App buildInfo={buildInfo} fetcher={signedOut} />);

    await user.click(screen.getByRole('button', { name: "What's new (new changes)" }));
    const dialog = screen.getByRole('dialog', { name: "What's new in 0.1.0" });
    expect(dialog.textContent).toContain('Phase 1: project skeleton');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: "What's new" })).toBeTruthy();
    expect(localStorage.getItem('flowcanvas-whats-new-seen')).toBe(releases[0]?.version);

    unmount();
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    expect(screen.getByRole('button', { name: "What's new" })).toBeTruthy();
  });

  it('opens Labs, which honestly has no previews yet', async () => {
    const user = userEvent.setup();
    render(<App buildInfo={buildInfo} fetcher={signedOut} />);
    await user.click(screen.getByRole('button', { name: 'Labs' }));
    const labs = screen.getByRole('dialog', { name: 'Labs' });
    expect(labs.textContent).toContain('No previews right now');
  });
});
