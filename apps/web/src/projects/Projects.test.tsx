import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Projects } from './Projects';

afterEach(cleanup);

const rallly = {
  id: 'p-1',
  name: 'Rallly',
  repoUrl: 'https://github.com/lukevella/rallly',
  createdAt: '2026-10-31T09:00:00.000Z',
  workspace: { id: 'w-1', state: 'not_created' },
};

/** A fake /api/projects: GET answers `list`, POST answers `created` (or an error response). */
function api(list: unknown[], created: () => Response = () => Response.json({}, { status: 500 })) {
  return vi.fn<typeof fetch>((_input, init) =>
    Promise.resolve(init?.method === 'POST' ? created() : Response.json({ projects: list })),
  );
}

describe('Projects', () => {
  it('says there are none yet', async () => {
    render(<Projects fetcher={api([])} />);
    expect(await screen.findByText('No projects yet. Create one above.')).toBeTruthy();
  });

  it('lists projects with their repository address', async () => {
    render(<Projects fetcher={api([rallly])} />);
    const list = await screen.findByRole('list', { name: 'Your projects' });
    expect(within(list).getByText('Rallly')).toBeTruthy();
    expect(within(list).getByText('https://github.com/lukevella/rallly')).toBeTruthy();
    expect(within(list).getByText(/Workspace not created yet/)).toBeTruthy();
  });

  it('opens a project’s secrets from its row', async () => {
    const fetcher = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        (input as string).endsWith('/secrets')
          ? Response.json({ secrets: [] })
          : Response.json({ projects: [rallly] }),
      ),
    );
    const user = userEvent.setup();
    render(<Projects fetcher={fetcher} />);
    const toggle = await screen.findByRole('button', { name: 'Secrets' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('region', { name: 'Secrets for Rallly' })).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p-1/secrets', expect.anything());
  });

  it('creates a project, shows it first and clears the form', async () => {
    const documenso = { ...rallly, id: 'p-2', name: 'Documenso', repoUrl: null };
    const fetcher = api([rallly], () => Response.json({ project: documenso }, { status: 201 }));
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
    expect(init?.method).toBe('POST');
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
    const fetcher = api([], () =>
      Response.json(
        { error: 'Remove the username or token from the address.', field: 'repoUrl' },
        { status: 400 },
      ),
    );
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
    expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBeNull();
  });

  it('says plainly when the projects can’t be loaded', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline')));
    render(<Projects fetcher={fetcher} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t reach Flowcanvas. Check your connection and try again.',
    );
  });
});
