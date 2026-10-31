// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { requireAdmin, requireUser, type SignedInEnv } from './guards.js';

let db: Database;
const env = { DATABASE_URL: 'postgresql://unused-by-the-fake-database' };

beforeEach(async () => {
  db = await migratedDatabase();
});

function app() {
  const deps = { database: () => db, log: vi.fn() };
  const routes = new Hono<SignedInEnv>();
  routes.get('/mine', requireUser(deps), (c) => c.json({ name: c.get('user').displayName }));
  routes.get('/admin', requireUser(deps), requireAdmin, (c) => c.json({ ok: true }));
  return routes;
}

async function sessionFor(email: string, role: 'member' | 'admin'): Promise<string> {
  return (await signedInAs(db, email, role)).cookie;
}

describe('requireUser', () => {
  it('turns away requests without a session', async () => {
    const response = await app().request('/mine', {}, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in first.' });
  });

  it('turns away an unknown or ended session', async () => {
    const response = await app().request(
      '/mine',
      { headers: { cookie: '__Host-fc_session=x' } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it('passes the signed-in user to the route', async () => {
    const cookie = await sessionFor('ada@example.com', 'member');
    const response = await app().request('/mine', { headers: { cookie } }, env);
    expect(await response.json()).toEqual({ name: 'ada' });
  });
});

describe('requireAdmin', () => {
  it('lets admins through', async () => {
    const cookie = await sessionFor('ada@example.com', 'admin');
    expect((await app().request('/admin', { headers: { cookie } }, env)).status).toBe(200);
  });

  it('turns members away with 403', async () => {
    const cookie = await sessionFor('grace@example.com', 'member');
    const response = await app().request('/admin', { headers: { cookie } }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only admins can do this.' });
  });
});
