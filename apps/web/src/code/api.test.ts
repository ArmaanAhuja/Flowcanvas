import { describe, expect, it } from 'vitest';
import { fetchTree, readFile, saveFile } from './api';

const answer =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(Response.json(body, { status }));
const version = 'e'.repeat(64);

describe('the file API', () => {
  it('lists the files, keeping only paths', async () => {
    expect(
      await fetchTree('p', answer(200, { files: ['a.ts', 7, 'b.ts'], truncated: false })),
    ).toEqual({
      files: ['a.ts', 'b.ts'],
      truncated: false,
    });
    expect(await fetchTree('p', answer(409, { error: 'Open the workspace first.' }))).toEqual({
      message: 'Open the workspace first.',
    });
  });

  it('reads text with its version, binary as binary, and passes refusals on with their reason', async () => {
    expect(
      await readFile(
        'p',
        'a.ts',
        answer(200, { content: 'x', encoding: 'utf8', version, size: 1 }),
      ),
    ).toEqual({
      kind: 'text',
      content: 'x',
      version,
    });
    expect(
      await readFile(
        'p',
        'logo.png',
        answer(200, { content: 'iVA', encoding: 'base64', version, size: 3 }),
      ),
    ).toEqual({ kind: 'binary', size: 3 });
    expect(
      await readFile(
        'p',
        '.env',
        answer(403, { error: 'Secrets live in the project’s vault.', code: 'secret_file' }),
      ),
    ).toEqual({
      kind: 'refused',
      code: 'secret_file',
      message: 'Secrets live in the project’s vault.',
    });
    expect(
      await readFile('p', 'a.ts', () => Promise.reject(new TypeError('offline'))),
    ).toMatchObject({
      kind: 'refused',
      code: 'unreachable',
    });
  });

  it('saves from the version the text was opened at, and tells a conflict from other failures', async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const fetcher: typeof fetch = (url, init) => {
      sent = {
        url: url instanceof Request ? url.url : url.toString(),
        ...(init === undefined ? {} : { init }),
      };
      return Promise.resolve(Response.json({ path: 'src/a.ts', size: 1, version: 'f'.repeat(64) }));
    };
    expect(await saveFile('p 1', 'src/a.ts', 'y', version, fetcher)).toEqual({
      kind: 'saved',
      version: 'f'.repeat(64),
    });
    expect(sent?.url).toBe('/api/projects/p%201/workspace/file?path=src%2Fa.ts');
    expect(JSON.parse(typeof sent?.init?.body === 'string' ? sent.init.body : '')).toEqual({
      content: 'y',
      encoding: 'utf8',
      baseVersion: version,
    });
    expect(
      await saveFile(
        'p',
        'a.ts',
        'y',
        version,
        answer(409, { error: 'This file changed.', code: 'conflict' }),
      ),
    ).toEqual({ kind: 'conflict', message: 'This file changed.' });
    expect(
      await saveFile(
        'p',
        'a.ts',
        'y',
        version,
        answer(409, { error: 'Open the workspace first.', code: 'not_running' }),
      ),
    ).toEqual({ kind: 'failed', message: 'Open the workspace first.' });
  });
});
