import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSecrets } from './ProjectSecrets';

afterEach(cleanup);

const CANARY = 'CANARY-sk_live_4242';
const stripe = {
  name: 'STRIPE_KEY',
  addedBy: 'Ada',
  createdAt: '2026-10-31T09:00:00.000Z',
  updatedAt: '2026-10-31T09:00:00.000Z',
};

/** A fake secrets API holding names only, as the real one does. */
function api(initial: (typeof stripe)[] = [], putAnswer?: () => Response) {
  let names = initial.map((secret) => secret.name);
  return vi.fn<typeof fetch>((input, init) => {
    const name = decodeURIComponent((input as string).split('/').at(-1) ?? '');
    if (init?.method === 'PUT') {
      if (putAnswer) return Promise.resolve(putAnswer());
      const created = !names.includes(name);
      names = [...new Set([...names, name])];
      return Promise.resolve(
        Response.json(
          { name, result: created ? 'created' : 'replaced' },
          { status: created ? 201 : 200 },
        ),
      );
    }
    if (init?.method === 'DELETE') {
      names = names.filter((existing) => existing !== name);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(Response.json({ secrets: names.map((n) => ({ ...stripe, name: n })) }));
  });
}

function renderSecrets(fetcher: typeof fetch) {
  render(<ProjectSecrets projectId="p-1" projectName="Rallly" fetcher={fetcher} />);
}

describe('ProjectSecrets', () => {
  it('lists secrets by name with the value hidden, and who added them', async () => {
    renderSecrets(api([stripe]));
    const list = await screen.findByRole('list', { name: 'Saved secrets' });
    expect(within(list).getByText('STRIPE_KEY')).toBeTruthy();
    expect(within(list).getByLabelText('Value hidden').textContent).toBe('••••••••');
    expect(within(list).getByText(/Added by Ada/)).toBeTruthy();
  });

  it('saves a value, clears it from the page and never shows it', async () => {
    const fetcher = api();
    const user = userEvent.setup();
    renderSecrets(fetcher);
    await screen.findByText('No secrets yet.');

    await user.type(screen.getByLabelText('Name'), 'DATABASE_URL');
    await user.type(screen.getByLabelText('Value'), CANARY);
    expect(screen.getByLabelText('Value').getAttribute('type')).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Save secret' }));

    expect((await screen.findByRole('status')).textContent).toBe('Saved DATABASE_URL.');
    expect(await screen.findByText('DATABASE_URL')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Value').value).toBe('');
    expect(document.body.innerHTML).not.toContain('CANARY');

    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/projects/p-1/secrets/DATABASE_URL');
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ value: CANARY });
  });

  it('says it will replace a secret that already has that name', async () => {
    const user = userEvent.setup();
    renderSecrets(api([stripe]));
    await screen.findByText('STRIPE_KEY');
    await user.type(screen.getByLabelText('Name'), 'STRIPE_KEY');
    await user.type(screen.getByLabelText('Value'), 'new');
    await user.click(screen.getByRole('button', { name: 'Replace STRIPE_KEY' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Replaced the value of STRIPE_KEY.',
    );
  });

  it('shows the API’s reason next to the field it names', async () => {
    const user = userEvent.setup();
    renderSecrets(
      api([], () =>
        Response.json(
          { error: 'Use capital letters, digits and underscores.', field: 'name' },
          { status: 400 },
        ),
      ),
    );
    await screen.findByText('No secrets yet.');
    await user.type(screen.getByLabelText('Name'), 'database_url');
    await user.type(screen.getByLabelText('Value'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save secret' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Use capital letters, digits and underscores.');
    expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('deletes only after a second, explicit click', async () => {
    const fetcher = api([stripe]);
    const user = userEvent.setup();
    renderSecrets(fetcher);
    await user.click(await screen.findByRole('button', { name: 'Delete STRIPE_KEY' }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await user.click(screen.getByRole('button', { name: 'Delete STRIPE_KEY' }));
    await user.click(
      screen.getByText('Delete STRIPE_KEY', { selector: 'button[data-kind="danger"]' }),
    );
    expect((await screen.findByRole('status')).textContent).toBe('Deleted STRIPE_KEY.');
    expect(await screen.findByText('No secrets yet.')).toBeTruthy();
  });
});
