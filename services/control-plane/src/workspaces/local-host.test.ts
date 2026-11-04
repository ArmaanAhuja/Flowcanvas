// The local workspace host's adapter, with a fake fetch standing in for the host.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES, isLoopbackUrl, localHostFromEnv, localHostProvider } from './local-host.js';
import { ProviderError } from './provider.js';

const TOKEN = 'CANARY'.padEnd(64, 'x');
const URL_ = 'http://127.0.0.1:8790';
const REF = 'fc-ws-00000000-0000-4000-8000-000000000001';

type Fetch = typeof fetch;

function host(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetcher = vi.fn<Fetch>((input, init) =>
    Promise.resolve(answer(input instanceof Request ? input.url : String(input), init ?? {})),
  );
  return { fetcher, provider: localHostProvider({ url: URL_, token: TOKEN, fetch: fetcher }) };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('localHostFromEnv', () => {
  const fetcher = vi.fn<Fetch>();

  it('gives no provider without a host address (staging)', () => {
    expect(localHostFromEnv({}, fetcher)).toBeUndefined();
    expect(localHostFromEnv({ WORKSPACE_HOST_TOKEN: TOKEN }, fetcher)).toBeUndefined();
  });

  it('only ever talks to this computer, so the token goes nowhere else', () => {
    for (const url of [
      'https://127.0.0.1:8790',
      'http://10.0.0.5:8790',
      'http://evil.example:8790',
      'http://127.0.0.1.evil.example:8790',
      'http://user:pass@127.0.0.1:8790',
      'http://127.0.0.1:8790/elsewhere',
      'not a url',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
      expect(
        localHostFromEnv({ WORKSPACE_HOST_URL: url, WORKSPACE_HOST_TOKEN: TOKEN }, fetcher),
      ).toBeUndefined();
    }
    expect(isLoopbackUrl('http://localhost:8790')).toBe(true);
    expect(isLoopbackUrl(URL_)).toBe(true);
  });

  it('says what to fix when the token is missing', async () => {
    const provider = localHostFromEnv({ WORKSPACE_HOST_URL: URL_ }, fetcher);
    const error = await rejection(
      provider?.create({ workspaceId: 'w', repoUrl: null }) ?? Promise.resolve(),
    );
    expect(error).toMatchObject({ kind: 'unavailable', userMessage: MESSAGES.noToken });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('gives the docker-local provider when both are set', () => {
    expect(
      localHostFromEnv({ WORKSPACE_HOST_URL: URL_, WORKSPACE_HOST_TOKEN: TOKEN }, fetcher)?.name,
    ).toBe('docker-local');
  });
});

describe('localHostProvider', () => {
  it('creates with the token, as JSON, and returns the reference', async () => {
    const { fetcher, provider } = host(() => json(200, { ref: REF, cloned: true, cloneMs: 6200 }));
    expect(
      await provider.create({ workspaceId: 'w-1', repoUrl: 'https://github.com/a/b' }),
    ).toEqual({ ref: REF });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${URL_}/v1/workspaces`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{"workspaceId":"w-1","repoUrl":"https://github.com/a/b"}',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('calls the four actions at their paths', async () => {
    const { fetcher, provider } = host(() => new Response(null, { status: 204 }));
    await provider.start(REF);
    await provider.pause(REF);
    await provider.resume(REF);
    await provider.stop(REF);
    expect(
      fetcher.mock.calls.map(([url]) =>
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      ),
    ).toEqual(
      ['start', 'pause', 'resume', 'stop'].map(
        (action) => `${URL_}/v1/workspaces/${REF}/${action}`,
      ),
    );
  });

  it("says the host isn't running when it can't be reached", async () => {
    const fetcher = vi.fn<Fetch>(() => Promise.reject(new TypeError('fetch failed: ECONNREFUSED')));
    const provider = localHostProvider({ url: URL_, token: TOKEN, fetch: fetcher });
    expect(await rejection(provider.pause(REF))).toMatchObject({
      kind: 'unavailable',
      userMessage: MESSAGES.notRunning,
    });
  });

  it("passes the host's errors through: its kind and its sentence", async () => {
    const { provider } = host(() =>
      json(409, {
        error: { kind: 'refused', message: '2 workspaces are already running on this computer.' },
      }),
    );
    expect(await rejection(provider.start(REF))).toMatchObject({
      kind: 'refused',
      userMessage: '2 workspaces are already running on this computer.',
    });
  });

  it('refuses errors it does not recognise, instead of showing them', async () => {
    for (const answer of [
      json(500, { error: { kind: 'explode', message: 'x' } }),
      json(422, { error: { kind: 'failed', message: 'x'.repeat(301) } }),
      json(422, { error: { kind: 'failed', message: '' } }),
      new Response('<html>proxy error</html>', { status: 502 }),
    ]) {
      const { provider } = host(() => answer.clone());
      expect(await rejection(provider.stop(REF))).toMatchObject({
        kind: 'failed',
        userMessage: MESSAGES.unexpected,
      });
    }
  });

  it('explains a token mismatch', async () => {
    const { provider } = host(() =>
      json(401, { error: { kind: 'refused', message: 'Wrong or missing token.' } }),
    );
    expect(await rejection(provider.stop(REF))).toMatchObject({ userMessage: MESSAGES.noToken });
  });

  it('refuses a create answer without a reference', async () => {
    for (const body of [{}, { ref: '' }, { ref: 7 }, { ref: 'x'.repeat(201) }]) {
      const { provider } = host(() => json(200, body));
      expect(await rejection(provider.create({ workspaceId: 'w', repoUrl: null }))).toMatchObject({
        kind: 'failed',
      });
    }
  });

  it('never puts the token in an error', async () => {
    const { provider } = host(() => json(500, {}));
    const error = await rejection(provider.stop(REF));
    expect(`${error.message} ${error.userMessage}`).not.toContain('CANARY');
  });

  it('asks the agent and checks its answer, with time for the command on top', async () => {
    const answer = { ok: true, result: { protocol: 1, node: 'v24' } };
    const { fetcher, provider } = host(() => json(200, answer));
    expect(await provider.agent(REF, { op: 'hello' })).toEqual(answer);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`${URL_}/v1/workspaces/${REF}/agent`);
    expect(init?.body).toBe('{"op":"hello"}');

    for (const nonsense of [
      { ok: 'yes' },
      { ok: false, error: { code: 'pwned', message: 'x' } },
      {},
    ]) {
      const { provider: other } = host(() => json(200, nonsense));
      expect(await rejection(other.agent(REF, { op: 'hello' }))).toMatchObject({ kind: 'failed' });
    }
  });
});
