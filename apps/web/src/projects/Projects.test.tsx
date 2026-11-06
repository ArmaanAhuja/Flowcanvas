import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Workspace, WorkspaceState } from './api';
import { MACHINE, POLL_MS, TEXT, useWorkspace } from './ProjectWorkspace';
import { Projects, WORKSPACES_LOCAL_ONLY } from './Projects';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const workspace = (state: WorkspaceState, failure: string | null = null): Workspace => ({
  id: 'w-1',
  state,
  stateChangedAt: '2026-11-05T09:30:00.000Z',
  failure,
});

const rallly: Project = {
  id: 'p-1',
  name: 'Rallly',
  repoUrl: 'https://github.com/lukevella/rallly',
  repoCommit: null,
  createdAt: '2026-10-31T09:00:00.000Z',
  workspace: workspace('not_created'),
};

type Answer = (init: RequestInit | undefined) => Response;

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

/** A fake API: answers by "METHOD path"; GET /api/projects answers the list (and availability). */
function api(
  list: Project[],
  routes: Record<string, Answer> = {},
  options: { available?: boolean } = {},
) {
  return vi.fn<typeof fetch>((input, init) => {
    const key = `${init?.method ?? 'GET'} ${urlOf(input)}`;
    const route = routes[key];
    if (route !== undefined) return Promise.resolve(route(init));
    if (key === 'GET /api/projects') {
      return Promise.resolve(
        Response.json({ projects: list, workspacesAvailable: options.available ?? true }),
      );
    }
    return Promise.resolve(Response.json({ error: `not faked: ${key}` }, { status: 500 }));
  });
}

const row = async (name: string) => {
  const list = await screen.findByRole('list', { name: 'Your projects' });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(name) !== null);
  if (item === undefined) throw new Error(`no row for ${name}`);
  return within(item);
};

describe('Projects', () => {
  it('says there are none yet', async () => {
    render(<Projects fetcher={api([])} />);
    expect(await screen.findByText('No projects yet. Create one above.')).toBeTruthy();
  });

  it('lists projects with their repository address and workspace status', async () => {
    render(<Projects fetcher={api([rallly])} />);
    const item = await row('Rallly');
    expect(item.getByText('https://github.com/lukevella/rallly')).toBeTruthy();
    expect(item.getByText('Not started')).toBeTruthy();
    expect(item.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('opens a project’s secrets from its row', async () => {
    const fetcher = api([rallly], {
      'GET /api/projects/p-1/secrets': () => Response.json({ secrets: [] }),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    const toggle = await screen.findByRole('button', { name: 'Secrets' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('region', { name: 'Secrets for Rallly' })).toBeTruthy();
  });

  it('creates a project, shows it first and clears the form', async () => {
    const documenso = { ...rallly, id: 'p-2', name: 'Documenso', repoUrl: null };
    const fetcher = api([rallly], {
      'POST /api/projects': () => Response.json({ project: documenso }, { status: 201 }),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await screen.findByText('Rallly');

    await user.type(screen.getByLabelText('Project name'), 'Documenso');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    const items = within(await screen.findByRole('list', { name: 'Your projects' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => within(item).getByText(/^(Documenso|Rallly)$/).textContent)).toEqual(
      ['Documenso', 'Rallly'],
    );
    expect(screen.getByLabelText<HTMLInputElement>('Project name').value).toBe('');
    const [, init] = fetcher.mock.calls.at(-1) ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'Documenso', repoUrl: '' });
  });

  it('asks for a name before sending anything', async () => {
    const fetcher = api([]);
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await screen.findByText(/No projects yet/);
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByRole('alert').textContent).toBe('Give the project a name.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shows the API’s reason next to the field it names', async () => {
    const fetcher = api([], {
      'POST /api/projects': () =>
        Response.json(
          { error: 'Remove the username or token from the address.', field: 'repoUrl' },
          { status: 400 },
        ),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await screen.findByText(/No projects yet/);
    await user.type(screen.getByLabelText('Project name'), 'Rallly');
    await user.type(
      screen.getByLabelText('Repository address (optional)'),
      'https://t@github.com/x',
    );
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Remove the username or token from the address.');
    const repo = screen.getByLabelText('Repository address (optional)');
    expect(repo.getAttribute('aria-invalid')).toBe('true');
    expect(repo.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('says plainly when the projects can’t be loaded', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline')));
    render(<Projects fetcher={fetcher} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t reach Flowcanvas. Check your connection and try again.',
    );
  });
});

describe('workspaces on the page', () => {
  it('says once that workspaces run locally where they can’t run here, and offers nothing that can’t work', async () => {
    render(<Projects fetcher={api([rallly], {}, { available: false })} />);
    expect((await screen.findByRole('status')).textContent).toBe(WORKSPACES_LOCAL_ONLY);
    await screen.findByText('Rallly');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open demo project' })).toBeNull();
    expect(screen.queryByText('Not started')).toBeNull();
  });

  it('opens a workspace: Starting… with what it’s doing, then Running with a terminal', async () => {
    let finish: (response: Response) => void = () => undefined;
    const listOnly = api([rallly]);
    // The open request is held until the test lets it finish, like a real clone.
    const fetcher = vi.fn<typeof fetch>((input, init) =>
      urlOf(input) === '/api/projects/p-1/workspace/open'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : listOnly(input, init),
    );
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    const item = await row('Rallly');
    expect(item.getByText('Starting…')).toBeTruthy();
    const card = item.getByRole('region', { name: 'Rallly workspace starting' });
    expect(
      within(card).getByText(TEXT.cloning('https://github.com/lukevella/rallly', null)),
    ).toBeTruthy();
    expect(
      within(card).getByText(/^Cloning github\.com\/lukevella\/rallly\. Usually/),
    ).toBeTruthy();
    // No made-up percentage: an indeterminate bar has no value.
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();

    await act(async () => {
      finish(Response.json({ workspace: workspace('running') }));
      await Promise.resolve();
    });
    expect(await item.findByText('Running · 2 cores')).toBeTruthy();
    expect(item.queryByRole('region', { name: 'Rallly workspace starting' })).toBeNull();
    expect(item.getByRole('button', { name: 'Terminal' })).toBeTruthy();
    expect(item.getByRole('button', { name: 'Sleep' })).toBeTruthy();
    expect(item.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('shows the resource guard’s refusal as said, and leaves the workspace as it was', async () => {
    const refusal =
      'This computer is low on memory (under 4 GiB available), so a workspace can’t start now.';
    const fetcher = api([rallly], {
      'POST /api/projects/p-1/workspace/open': () =>
        Response.json(
          { error: refusal, problem: 'refused', workspace: workspace('not_created') },
          { status: 503 },
        ),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe(refusal);
    expect((await row('Rallly')).getByText('Not started')).toBeTruthy();
  });

  it('shows an asleep workspace with its reason and real facts only, and resumes it', async () => {
    const asleep = {
      ...rallly,
      workspace: workspace('sleeping', 'Put to sleep after 10 minutes without activity.'),
    };
    const fetcher = api([asleep], {
      'POST /api/projects/p-1/workspace/resume': () =>
        Response.json({ workspace: workspace('running') }),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    const card = await screen.findByRole('region', { name: 'Rallly workspace asleep' });
    expect(within(card).getByText(TEXT.asleepTitle)).toBeTruthy();
    expect(within(card).getByText('Put to sleep after 10 minutes without activity.')).toBeTruthy();
    expect(within(card).getByText(TEXT.asleepKept)).toBeTruthy();
    expect(within(card).getByText(MACHINE)).toBeTruthy();
    // Nothing the system doesn't have yet (backups and checkpoints come in phase 18a).
    expect(card.textContent).not.toMatch(/backup|checkpoint/i);
    expect(screen.queryByRole('button', { name: 'Terminal' })).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('Running · 2 cores')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/p-1/workspace/resume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('never says a sleep the person asked for was idle', async () => {
    render(<Projects fetcher={api([{ ...rallly, workspace: workspace('sleeping') }])} />);
    const card = await screen.findByRole('region', { name: 'Rallly workspace asleep' });
    expect(card.textContent).not.toMatch(/idle|without activity/i);
  });

  it('says why a workspace stopped or failed, with a way to try again', async () => {
    const stopped = {
      ...rallly,
      workspace: workspace(
        'stopped',
        'Stopped to free memory on this computer. Its files are kept: open it to start it again.',
      ),
    };
    const failed = {
      ...rallly,
      id: 'p-2',
      name: 'Documenso',
      workspace: workspace('failed', 'The repository couldn’t be cloned.'),
    };
    render(<Projects fetcher={api([stopped, failed])} />);
    const first = await row('Rallly');
    expect(first.getByRole('status').textContent).toMatch(/^Stopped to free memory/);
    expect(first.getByRole('button', { name: 'Open' })).toBeTruthy();
    const second = await row('Documenso');
    expect(second.getByText('Couldn’t start')).toBeTruthy();
    expect(second.getByRole('status').textContent).toBe('The repository couldn’t be cloned.');
    expect(second.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('Open demo project: makes or finds the demo, puts it first, and opens it in one click', async () => {
    const demo: Project = {
      ...rallly,
      id: 'p-demo',
      name: 'Rallly (demo)',
      repoUrl: 'https://github.com/ArmaanAhuja-7777/rallly',
      repoCommit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
    };
    const fetcher = api([rallly], {
      'POST /api/projects/demo': () => Response.json({ project: demo }, { status: 201 }),
      'POST /api/projects/p-demo/workspace/open': () =>
        Response.json({ workspace: { ...workspace('running'), id: 'w-demo' } }),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await user.click(await screen.findByRole('button', { name: 'Open demo project' }));

    const items = within(await screen.findByRole('list', { name: 'Your projects' })).getAllByRole(
      'listitem',
    );
    expect(items[0]?.textContent).toContain('Rallly (demo)');
    const item = await row('Rallly (demo)');
    expect(
      item.getByText('https://github.com/ArmaanAhuja-7777/rallly · pinned at 8e67a21'),
    ).toBeTruthy();
    expect(await item.findByText('Running · 2 cores')).toBeTruthy();
    const calls = fetcher.mock.calls.map(
      ([input, init]) => `${init?.method ?? 'GET'} ${urlOf(input)}`,
    );
    expect(calls).toEqual([
      'GET /api/projects',
      'POST /api/projects/demo',
      'POST /api/projects/p-demo/workspace/open',
    ]);
  });

  it('explains when the demo can’t be made', async () => {
    const fetcher = api([], {
      'POST /api/projects/demo': () =>
        Response.json(
          {
            error:
              'You already have another project named Rallly (demo). Rename it, then try again.',
          },
          { status: 409 },
        ),
    });
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    await user.click(await screen.findByRole('button', { name: 'Open demo project' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /^You already have another project/,
    );
  });
});

describe('useWorkspace polling', () => {
  it('asks again every 3 s while changing and every 30 s while running, and not otherwise', async () => {
    vi.useFakeTimers();
    const answers = [workspace('creating'), workspace('running'), workspace('sleeping')];
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ workspace: answers.shift() })),
    );
    const { result } = renderHook(() => useWorkspace('p-1', workspace('creating'), fetcher));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS.changing - 1);
    });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p-1/workspace', expect.anything());
    // Still creating, so again after 3 s; then running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS.changing);
    });
    expect(result.current.workspace.state).toBe('running');
    // Running: the next check waits 30 s, and finds it asleep (an idle sleep, without a reload).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS.changing);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS.running);
    });
    expect(result.current.workspace.state).toBe('sleeping');
    // Asleep: nothing to watch for.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS.running * 3);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
