import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabsProvider } from '../labs/LabsProvider';
import type { Project, Workspace, WorkspaceState } from '../projects/api';
import { MACHINE } from '../projects/ProjectWorkspace';
import { ProjectPage } from './ProjectPage';

afterEach(cleanup);

const workspace = (state: WorkspaceState, failure: string | null = null): Workspace => ({
  id: 'w-1',
  state,
  stateChangedAt: '2026-11-07T09:30:00.000Z',
  failure,
});

const project = (state: WorkspaceState, failure: string | null = null): Project => ({
  id: 'p-1',
  name: 'Rallly',
  repoUrl: 'https://github.com/lukevella/rallly',
  repoCommit: null,
  createdAt: '2026-11-07T09:00:00.000Z',
  workspace: workspace(state, failure),
});

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

/** A fake API by route: the project list, this month's usage, and the workspace's actions. */
function api(start: Project, available = true) {
  return vi.fn<typeof fetch>((input, init) => {
    const path = urlOf(input);
    if (path === '/api/projects') {
      return Promise.resolve(Response.json({ projects: [start], workspacesAvailable: available }));
    }
    if (path === '/api/usage') {
      return Promise.resolve(
        Response.json({
          usage: {
            periodStart: '2026-11-01T00:00:00.000Z',
            resetsAt: '2026-12-01T00:00:00.000Z',
            workspaceSeconds: 3_900,
            storageByteHours: 0,
          },
        }),
      );
    }
    if (init?.method === 'POST' && path.endsWith('/workspace/sleep')) {
      return Promise.resolve(Response.json({ workspace: workspace('sleeping') }));
    }
    return Promise.resolve(Response.json({ error: `not faked: ${path}` }, { status: 500 }));
  });
}

const show = (fetcher: typeof fetch) =>
  render(
    <LabsProvider>
      <ProjectPage projectId="p-1" fetcher={fetcher} />
    </LabsProvider>,
  );

describe('the workspace chip and its popover', () => {
  it('shows the recorded facts: status, machine, since when, and this month’s usage', async () => {
    const user = userEvent.setup();
    show(api(project('running')));
    await user.click(await screen.findByRole('button', { name: 'Workspace: Running' }));
    const popover = await screen.findByRole('dialog', { name: 'Workspace' });
    expect(within(popover).getByText('Running')).toBeTruthy();
    expect(within(popover).getByText(MACHINE)).toBeTruthy();
    expect(within(popover).getByText('Running since')).toBeTruthy();
    expect(await within(popover).findByText('1 h 5 min')).toBeTruthy();
    // Nothing that doesn't exist yet: backups (18a), regions and moving where it runs (48a).
    expect(popover.textContent).not.toMatch(/backup|region|where it runs/i);
  });

  it('Sleep now sleeps it, and the popover and the chip follow', async () => {
    const user = userEvent.setup();
    const fetcher = api(project('running'));
    show(fetcher);
    await user.click(await screen.findByRole('button', { name: 'Workspace: Running' }));
    await user.click(await screen.findByRole('button', { name: 'Sleep now' }));
    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/p-1/workspace/sleep',
      expect.objectContaining({ method: 'POST' }),
    );
    // The popover follows at once; outside it is hidden from screen readers while it's open (it's modal).
    const popover = screen.getByRole('dialog', { name: 'Workspace' });
    expect(await within(popover).findByRole('button', { name: 'Resume' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Workspace: Sleeping' })).toBeTruthy();
    // The dock following it needs real layout: checked in the browser (e2e/try-it/phase-2.spec.ts).
  });

  it('offers the actions that fit the state, and shows a recorded reason', async () => {
    const user = userEvent.setup();
    show(api(project('stopped', 'Stopped to free memory on this computer.')));
    await user.click(await screen.findByRole('button', { name: 'Workspace: Stopped' }));
    const popover = await screen.findByRole('dialog', { name: 'Workspace' });
    expect(within(popover).getByText('Stopped to free memory on this computer.')).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Sleep now' })).toBeNull();
    expect(within(popover).queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('isn’t there at all where workspaces can’t run (staging)', async () => {
    show(api(project('not_created'), false));
    await screen.findByText('Rallly');
    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull();
  });
});
