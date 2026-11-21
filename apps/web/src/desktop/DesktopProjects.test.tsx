// The desktop app's start (build plan v2, phase 1): Open folder through the bridge, the recent folders, and the site's
// accounts, usage and admin left out.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { DesktopBridge } from './bridge';
import { DESKTOP_TEXT, DesktopProjects } from './DesktopProjects';

afterEach(() => {
  cleanup();
  delete (window as { flowcanvasDesktop?: unknown }).flowcanvasDesktop;
  window.history.replaceState(null, '', '/');
});

const project = {
  id: 'p-1',
  name: 'my-app',
  path: '/home/me/code/my-app',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-21T09:00:00.000Z',
  workspace: {
    id: 'p-1',
    state: 'running',
    stateChangedAt: '2026-11-21T09:00:00.000Z',
    failure: null,
  },
};
const api = (projects: unknown[]) =>
  vi.fn<typeof fetch>((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === '/api/projects') {
      return Promise.resolve(Response.json({ projects, workspacesAvailable: true }));
    }
    if (url === '/api/me') {
      return Promise.resolve(
        Response.json({ user: { id: 'local', email: '', displayName: 'me', role: 'member' } }),
      );
    }
    return Promise.resolve(Response.json({ error: 'not faked' }, { status: 404 }));
  });
const bridge = (opened: { id: string } | null): DesktopBridge => ({
  openFolder: vi.fn(() => Promise.resolve(opened)),
});

describe('DesktopProjects', () => {
  it('lists the folders opened before, each with its path, opening its project', async () => {
    render(<DesktopProjects bridge={bridge(null)} fetcher={api([project])} />);
    const list = await screen.findByRole('list', { name: 'Recent projects' });
    const link = within(list).getByRole('link', { name: 'my-app' });
    expect(link.getAttribute('href')).toBe('/p/p-1');
    expect(within(list).getByText('/home/me/code/my-app')).toBeTruthy();
  });

  it('opens a folder through the system’s picker and goes to its project; cancelling stays here', async () => {
    const user = userEvent.setup();
    const openFolder = vi.fn(() => Promise.resolve(null));
    const { unmount } = render(<DesktopProjects bridge={{ openFolder }} fetcher={api([])} />);
    await user.click(await screen.findByRole('button', { name: DESKTOP_TEXT.open }));
    expect(openFolder).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/');
    unmount();
    render(<DesktopProjects bridge={bridge({ id: 'p-9' })} fetcher={api([])} />);
    await user.click(await screen.findByRole('button', { name: DESKTOP_TEXT.open }));
    expect(window.location.pathname).toBe('/p/p-9');
  });

  it('says how to start when nothing has been opened yet', async () => {
    render(<DesktopProjects bridge={bridge(null)} fetcher={api([])} />);
    expect(await screen.findByText(DESKTOP_TEXT.empty)).toBeTruthy();
  });

  it('says so when the picker fails, and lets the person try again', async () => {
    const user = userEvent.setup();
    const failing: DesktopBridge = { openFolder: () => Promise.reject(new Error('no')) };
    render(<DesktopProjects bridge={failing} fetcher={api([])} />);
    await user.click(await screen.findByRole('button', { name: DESKTOP_TEXT.open }));
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t open that folder');
    expect(screen.getByRole('button', { name: DESKTOP_TEXT.open })).toBeTruthy();
  });
});

describe('the home page in the desktop app', () => {
  it('shows the folders instead of the site’s sign-in, projects and usage', async () => {
    (window as { flowcanvasDesktop?: unknown }).flowcanvasDesktop = bridge(null);
    render(<App buildInfo={{ version: '0.15.0', commit: 'abc1234' }} fetcher={api([project])} />);
    expect(await screen.findByRole('button', { name: DESKTOP_TEXT.open })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /usage/i })).toBeNull();
  });
});
