import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Admin } from './Admin';

afterEach(cleanup);

const ada = {
  id: 'u-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'admin',
  providers: ['github', 'google'],
  projectCount: 2,
  workspaceSecondsThisMonth: 3900,
  createdAt: '2026-10-30T09:00:00.000Z',
  lastSignedInAt: '2026-10-31T09:00:00.000Z',
  allowed: true,
};
const grace = {
  ...ada,
  id: 'u-2',
  email: 'grace@example.com',
  displayName: 'Grace',
  role: 'member',
  providers: ['google'],
  projectCount: 1,
  workspaceSecondsThisMonth: 0,
  allowed: false,
};
const allowlist = [
  { email: 'ada@example.com', role: 'admin', addedAt: '2026-10-30T09:00:00.000Z', signedUp: true },
  {
    email: 'linus@example.com',
    role: 'member',
    addedAt: '2026-10-31T09:00:00.000Z',
    signedUp: false,
  },
];

/** A fake /api/admin: GET answers the view; changes answer `change()`. */
function api(change: () => Response = () => new Response(null, { status: 204 })) {
  return vi.fn<typeof fetch>((_input, init) =>
    Promise.resolve(
      init?.method === undefined ? Response.json({ people: [ada, grace], allowlist }) : change(),
    ),
  );
}

describe('Admin', () => {
  it('lists people with counts, providers and usage', async () => {
    render(<Admin ownEmail="ada@example.com" fetcher={api()} />);
    const people = await screen.findByRole('list', { name: 'People' });
    expect(within(people).getByText('Ada')).toBeTruthy();
    expect(
      within(people).getByText(/Admin · GitHub, Google · 2 projects · 1 h 5 min this month/),
    ).toBeTruthy();
    expect(within(people).getByText(/1 project · .*no longer on the allowlist/)).toBeTruthy();
  });

  it('never offers to change or remove your own entry', async () => {
    render(<Admin ownEmail="ada@example.com" fetcher={api()} />);
    const list = await screen.findByRole('list', { name: 'Allowed emails' });
    expect(within(list).queryByRole('button', { name: 'Remove ada@example.com' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Remove linus@example.com' })).toBeTruthy();
  });

  it('allows an email as admin with the switch', async () => {
    const fetcher = api(() =>
      Response.json({ email: 'kat@example.com', role: 'admin', result: 'added' }, { status: 201 }),
    );
    const user = userEvent.setup();
    render(<Admin ownEmail="ada@example.com" fetcher={fetcher} />);
    await user.type(await screen.findByLabelText('Email'), 'kat@example.com');
    await user.click(screen.getByRole('switch', { name: 'Admin' }));
    await user.click(screen.getByRole('button', { name: 'Allow email' }));

    expect((await screen.findByRole('status')).textContent).toBe('Allowed kat@example.com.');
    expect(fetcher).toHaveBeenCalledWith('/api/admin/allowlist/kat%40example.com', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('');
  });

  it('shows the API’s message next to the email field', async () => {
    const fetcher = api(() =>
      Response.json(
        { error: 'Enter a full email address, like ada@example.com.', field: 'email' },
        { status: 400 },
      ),
    );
    const user = userEvent.setup();
    render(<Admin ownEmail="ada@example.com" fetcher={fetcher} />);
    await user.type(await screen.findByLabelText('Email'), 'kat');
    await user.click(screen.getByRole('button', { name: 'Allow email' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter a full email address, like ada@example.com.',
    );
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('removes an email only after a second click', async () => {
    const fetcher = api();
    const user = userEvent.setup();
    render(<Admin ownEmail="ada@example.com" fetcher={fetcher} />);
    await user.click(await screen.findByRole('button', { name: 'Remove linus@example.com' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByText('Remove linus@example.com', { selector: 'button[data-kind="danger"]' }),
    );
    expect((await screen.findByRole('status')).textContent).toBe(
      'Removed linus@example.com. They’re signed out.',
    );
    expect(fetcher).toHaveBeenCalledWith('/api/admin/allowlist/linus%40example.com', {
      method: 'DELETE',
    });
  });

  it('says when the view can’t be loaded', async () => {
    render(
      <Admin
        ownEmail="ada@example.com"
        fetcher={() =>
          Promise.resolve(Response.json({ error: 'Only admins can do this.' }, { status: 403 }))
        }
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Only admins can do this.');
  });
});
