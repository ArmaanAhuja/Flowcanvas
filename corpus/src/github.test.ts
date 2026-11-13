import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETRIES, gitHubApi } from './check.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const answers = (...statuses: number[]) => {
  const fetch = vi.fn(() => {
    const status = statuses.shift() ?? 200;
    return Promise.resolve(new Response(status === 200 ? '{"ok":true}' : '', { status }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('gitHubApi', () => {
  it('retries GitHub’s own errors (a 502 failed CI once), then answers', async () => {
    vi.useFakeTimers();
    const fetch = answers(502, 200);
    const pending = gitHubApi('t').json('repos/a/b');
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('takes a 404 as an answer, never retried', async () => {
    const fetch = answers(404);
    expect(await gitHubApi('t').json('repos/a/missing')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still fails when GitHub keeps failing', async () => {
    vi.useFakeTimers();
    const fetch = answers(503, 503, 503, 503);
    const pending = gitHubApi('t').json('repos/a/b');
    const failed = expect(pending).rejects.toThrow('GitHub API 503 for repos/a/b');
    await vi.runAllTimersAsync();
    await failed;
    expect(fetch).toHaveBeenCalledTimes(RETRIES + 1);
  });
});
