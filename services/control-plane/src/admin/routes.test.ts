// /api/admin through the whole API: admin-only, same-origin changes, no self-lockout (PGlite).
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused-by-the-fake-database', APP_ORIGIN: APP };

let db: Database;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let admin: string;
let member: string;

beforeEach(async () => {
  db = await migratedDatabase();
  log = vi.fn<(message: string) => void>();
  admin = (await signedInAs(db, 'ada@example.com', 'admin')).cookie;
  member = (await signedInAs(db, 'grace@example.com')).cookie;
});

const api = () =>
  createApi({ database: () => db, log, now: () => Date.parse('2026-10-31T12:00:00Z') });

const view = (cookie?: string) =>
  api().request(`${APP}/api/admin`, cookie === undefined ? {} : { headers: { cookie } }, env);

function change(
  method: 'PUT' | 'DELETE',
  email: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return api().request(
    `${APP}/api/admin/allowlist/${encodeURIComponent(email)}`,
    {
      method,
      headers: { cookie: admin, origin: APP, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

describe('/api/admin', () => {
  it('is for admins only', async () => {
    expect((await view()).status).toBe(401);
    expect((await view(member)).status).toBe(403);
    expect(
      (await change('PUT', 'x@example.com', { role: 'member' }, { cookie: member })).status,
    ).toBe(403);
    expect(
      (await change('DELETE', 'grace@example.com', undefined, { cookie: member })).status,
    ).toBe(403);
  });

  it('shows people and the allowlist', async () => {
    const response = await view(admin);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { people: unknown[]; allowlist: { email: string }[] };
    expect(body.people).toHaveLength(2);
    expect(body.allowlist.map(({ email }) => email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });

  it('adds, changes and removes allowlist entries, and logs them without emails', async () => {
    expect(await (await change('PUT', 'Linus@Example.com', { role: 'member' })).json()).toEqual({
      email: 'linus@example.com',
      role: 'member',
      result: 'added',
    });
    const changed = await change('PUT', 'linus@example.com', { role: 'admin' });
    expect(changed.status).toBe(200);
    expect((await change('DELETE', 'linus@example.com')).status).toBe(204);
    expect((await change('DELETE', 'linus@example.com')).status).toBe(404);

    expect(log).toHaveBeenCalledTimes(3);
    for (const [line] of log.mock.calls) expect(line).not.toContain('linus');
  });

  it('signs a removed person out at once', async () => {
    expect((await change('DELETE', 'grace@example.com')).status).toBe(204);
    const response = await api().request(
      `${APP}/api/projects`,
      { headers: { cookie: member } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it('won’t let an admin lock themselves out', async () => {
    const demote = await change('PUT', 'ada@example.com', { role: 'member' });
    expect(demote.status).toBe(409);
    expect(await demote.json()).toEqual({ error: 'You can’t remove your own admin role.' });
    expect((await change('DELETE', 'ada@example.com')).status).toBe(409);
    expect((await view(admin)).status).toBe(200);
  });

  it('refuses bad input and requests from other sites', async () => {
    expect(await (await change('PUT', 'not-an-email', { role: 'member' })).json()).toEqual({
      error: 'Enter a full email address, like ada@example.com.',
      field: 'email',
    });
    expect((await change('PUT', 'x@example.com', { role: 'owner' })).status).toBe(400);
    expect(
      (await change('PUT', 'x@example.com', { role: 'member' }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await change('DELETE', 'grace@example.com', undefined, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect((await view(member)).status).toBe(403);
  });
});
