import { describe, expect, it, vi } from 'vitest';
import rootPackage from '../../../../package.json' with { type: 'json' };
import { createApi } from './app.js';
import { redact } from './redact.js';

// A canary: if this ever appears in a response or a log line, a secret has leaked.
const CANARY_URL =
  'postgresql://neondb_owner:canary-Pa55word@ep-canary-pooler.example.neon.tech/neondb';

describe('API', () => {
  it('answers /api/health with the version', async () => {
    const response = await createApi().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'control-plane',
      version: rootPackage.version,
    });
  });

  it('pings the database through the injected query', async () => {
    const query = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const database = vi.fn(() => ({ query }));
    let clock = 1000;
    const api = createApi({ database, now: () => (clock += 12) });
    const response = await api.request('/api/db/ping', {}, { DATABASE_URL: CANARY_URL });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ database: 'ok', roundTripMs: 12 });
    expect(database).toHaveBeenCalledWith(CANARY_URL);
    expect(query).toHaveBeenCalledWith('select 1 as ok');
  });

  it('says how to fix a missing DATABASE_URL', async () => {
    const response = await createApi().request('/api/db/ping', {}, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      database: 'not configured',
      fix: 'Set the DATABASE_URL secret',
    });
  });

  it('never leaks the connection string when the database fails', async () => {
    const log = vi.fn();
    const query = vi.fn().mockRejectedValue(new Error(`could not connect to ${CANARY_URL}`));
    const api = createApi({ database: () => ({ query }), log });
    const response = await api.request('/api/db/ping', {}, { DATABASE_URL: CANARY_URL });

    expect(response.status).toBe(503);
    const body = await response.text();
    const logged = log.mock.calls.flat().join('\n');
    for (const leak of [CANARY_URL, 'canary-Pa55word']) {
      expect(body).not.toContain(leak);
      expect(logged).not.toContain(leak);
    }
    expect(logged).toContain('postgresql://[redacted]');
  });

  it('answers unknown API paths with JSON 404', async () => {
    const response = await createApi().request('/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });
});

describe('redact', () => {
  it('removes connection strings and bearer tokens', () => {
    expect(redact(`at ${CANARY_URL} with Bearer abc.def-123`)).toBe(
      'at postgresql://[redacted] with Bearer [redacted]',
    );
  });

  it('removes provider tokens, OAuth values, our cookies and emails', () => {
    const cases: [string, string][] = [
      ['token gho_CANARYabc123 and ya29.CANARY-x_y', 'token [redacted token] and [redacted token]'],
      ['github_pat_11CANARY_zz', '[redacted token]'],
      [
        'GET /api/auth/callback/github?code=CANARY1&state=CANARY2',
        'GET /api/auth/callback/github?code=[redacted]&state=[redacted]',
      ],
      [
        'client_secret=CANARY3&code_verifier=CANARY4',
        'client_secret=[redacted]&code_verifier=[redacted]',
      ],
      ['{"access_token":"CANARY5","scope":"x"}', '{"access_token":"[redacted]","scope":"x"}'],
      [
        'cookie: __Host-fc_session=CANARY6; __Host-fc_oauth=github.CANARY7.CANARY8',
        'cookie: __Host-fc_session=[redacted]; __Host-fc_oauth=[redacted]',
      ],
      ['no account for Ada.Lovelace+x@example.co.uk', 'no account for [redacted email]'],
    ];
    for (const [input, expected] of cases) {
      expect(redact(input)).toBe(expected);
      expect(redact(input)).not.toContain('CANARY');
    }
  });

  it('leaves ordinary messages alone', () => {
    const message = 'admin 3f2c… added an allowlist entry (member); 2 sessions ended';
    expect(redact(message)).toBe(message);
  });
});

describe('logging', () => {
  it('redacts every log line, even from code that forgot to', async () => {
    const log = vi.fn();
    const query = vi.fn().mockRejectedValue(new Error('boom'));
    // A route that logs raw text: the wrapper in createApi still redacts it.
    const api = createApi({ database: () => ({ query }), log });
    await api.request('/api/db/ping', {}, { DATABASE_URL: CANARY_URL });
    expect(log).toHaveBeenCalledWith('database ping failed: Error: boom');

    const leaky = createApi({
      log,
      database: () => {
        throw new Error(`token gho_CANARY for ada@example.com at ${CANARY_URL}`);
      },
    });
    const response = await leaky.request('/api/db/ping', {}, { DATABASE_URL: CANARY_URL });
    expect(response.status).toBe(503);
    const logged = log.mock.calls.flat().join('\n');
    for (const leak of ['CANARY', 'ada@example.com', 'canary-Pa55word']) {
      expect(logged).not.toContain(leak);
    }
  });

  it('answers unexpected errors plainly and logs only a redacted description', async () => {
    const log = vi.fn();
    const api = createApi({ log });
    // A route that throws outside any try/catch, added just for this test.
    api.get('/explode', () => {
      throw new Error(`unexpected at ${CANARY_URL} with __Host-fc_session=CANARY-session`);
    });
    const response = await api.request('/api/explode');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Something went wrong. Try again in a moment.',
    });
    const logged = log.mock.calls.flat().join('\n');
    expect(logged).toContain('unhandled error on GET /api/explode');
    expect(logged).not.toContain('canary');
    expect(logged).not.toContain('CANARY');
  });
});
