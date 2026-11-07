import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answer, createAgent, serve, type Agent } from './agent.js';
import { AGENT_PROTOCOL, LIMITS, isSecretFile, type AgentResponse } from './protocol.js';

/** SHA-256 hex, computed here independently of the agent. */
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

let base: string;
let root: string;
let agent: Agent;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'fc-agent-'));
  root = join(base, 'project');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"name":"rallly"}\n');
  await writeFile(join(root, 'src', 'index.ts'), 'export {};\n');
  await writeFile(join(root, '.env'), 'DATABASE_URL=CANARY-postgres://secret\n');
  await writeFile(join(root, '.env.example'), 'DATABASE_URL=\n');
  await writeFile(join(base, 'outside.txt'), 'CANARY-outside\n');
  agent = createAgent({ root });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const ask = (body: unknown) => answer(agent, body);

function expectError(response: AgentResponse, code: string): void {
  expect(response.ok).toBe(false);
  if (!response.ok) expect(response.error.code).toBe(code);
}

describe('list', () => {
  it('lists folders first, then files, marking secret files', async () => {
    expect(await ask({ op: 'list', path: '' })).toEqual({
      ok: true,
      result: {
        path: '',
        truncated: false,
        entries: [
          { name: 'src', type: 'directory', size: 0, secret: false },
          { name: '.env', type: 'file', size: 38, secret: true },
          { name: '.env.example', type: 'file', size: 14, secret: false },
          { name: 'package.json', type: 'file', size: 18, secret: false },
        ],
      },
    });
    expect(await ask({ op: 'list', path: 'src' })).toMatchObject({
      result: { path: 'src', entries: [{ name: 'index.ts' }] },
    });
  });

  it('says so for a missing folder, a file, or a project that was never cloned', async () => {
    expectError(await ask({ op: 'list', path: 'nope' }), 'not_found');
    expectError(await ask({ op: 'list', path: 'package.json' }), 'not_a_directory');
    const empty = createAgent({ root: join(base, 'never-cloned') });
    expectError(await answer(empty, { op: 'list', path: '' }), 'not_found');
  });
});

describe('read', () => {
  it('reads text as utf8 and anything else as base64', async () => {
    expect(await ask({ op: 'read', path: 'package.json' })).toEqual({
      ok: true,
      result: {
        path: 'package.json',
        size: 18,
        encoding: 'utf8',
        content: '{"name":"rallly"}\n',
        version: sha('{"name":"rallly"}\n'),
      },
    });
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0xff]));
    expect(await ask({ op: 'read', path: 'logo.png' })).toMatchObject({
      result: {
        encoding: 'base64',
        content: 'iVAA/w==',
        version: sha(Buffer.from([0x89, 0x50, 0x00, 0xff])),
      },
    });
  });

  it('never reads a .env file, even through a link', async () => {
    const response = await ask({ op: 'read', path: '.env' });
    expectError(response, 'secret_file');
    expect(JSON.stringify(response)).not.toContain('CANARY');
    await symlink(join(root, '.env'), join(root, 'innocent.txt'));
    expectError(await ask({ op: 'read', path: 'innocent.txt' }), 'secret_file');
    expect(await ask({ op: 'read', path: '.env.example' })).toMatchObject({ ok: true });
  });

  it('never leaves the project: .., absolute paths and links out', async () => {
    for (const path of [
      '../outside.txt',
      'src/../../outside.txt',
      '/etc/passwd',
      join(base, 'outside.txt'),
    ]) {
      const response = await ask({ op: 'read', path });
      expectError(response, 'outside_project');
      expect(JSON.stringify(response)).not.toContain('CANARY');
    }
    await symlink(join(base, 'outside.txt'), join(root, 'link'));
    expectError(await ask({ op: 'read', path: 'link' }), 'outside_project');
    await symlink(base, join(root, 'up'));
    expectError(await ask({ op: 'list', path: 'up' }), 'outside_project');
  });

  it('refuses folders and big files', async () => {
    expectError(await ask({ op: 'read', path: 'src' }), 'is_a_directory');
    await writeFile(join(root, 'big.bin'), Buffer.alloc(LIMITS.fileBytes + 1));
    expectError(await ask({ op: 'read', path: 'big.bin' }), 'too_large');
  });
});

describe('write', () => {
  it('writes text or base64, making folders as needed', async () => {
    expect(
      await ask({ op: 'write', path: 'notes/today.md', content: '# Hi\n', encoding: 'utf8' }),
    ).toEqual({
      ok: true,
      result: { path: 'notes/today.md', size: 5, version: sha('# Hi\n') },
    });
    expect(await readFile(join(root, 'notes', 'today.md'), 'utf8')).toBe('# Hi\n');
    await ask({ op: 'write', path: 'a.bin', content: 'iVAA/w==', encoding: 'base64' });
    expect([...(await readFile(join(root, 'a.bin')))]).toEqual([0x89, 0x50, 0x00, 0xff]);
  });

  it('never writes a .env file, outside the project, or through a link', async () => {
    expectError(
      await ask({ op: 'write', path: '.env.local', content: 'x', encoding: 'utf8' }),
      'secret_file',
    );
    expectError(
      await ask({ op: 'write', path: '../x.txt', content: 'x', encoding: 'utf8' }),
      'outside_project',
    );
    await symlink(join(base, 'outside.txt'), join(root, 'link.txt'));
    expectError(
      await ask({ op: 'write', path: 'link.txt', content: 'x', encoding: 'utf8' }),
      'not_allowed',
    );
    await symlink(base, join(root, 'up'));
    expectError(
      await ask({ op: 'write', path: 'up/new.txt', content: 'x', encoding: 'utf8' }),
      'outside_project',
    );
    expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('CANARY-outside\n');
  });

  it('refuses too much content, folders and the project itself', async () => {
    const big = 'x'.repeat(LIMITS.fileBytes + 1);
    expectError(
      await ask({ op: 'write', path: 'big.txt', content: big, encoding: 'utf8' }),
      'too_large',
    );
    // Within the character bound, but over 1 MiB once encoded (3 bytes each).
    const wide = '€'.repeat(LIMITS.fileBytes / 2);
    expectError(
      await ask({ op: 'write', path: 'wide.txt', content: wide, encoding: 'utf8' }),
      'too_large',
    );
    expectError(
      await ask({ op: 'write', path: 'src', content: 'x', encoding: 'utf8' }),
      'is_a_directory',
    );
    expectError(
      await ask({ op: 'write', path: '', content: 'x', encoding: 'utf8' }),
      'is_a_directory',
    );
    expectError(
      await ask({ op: 'write', path: 'package.json/x', content: 'x', encoding: 'utf8' }),
      'not_a_directory',
    );
  });
});

describe('conflict-safe writes', () => {
  const original = '{"name":"rallly"}\n';

  it('writes when the file is still the version it was edited from', async () => {
    const response = await ask({
      op: 'write',
      path: 'package.json',
      content: '{"name":"rallly","private":true}\n',
      encoding: 'utf8',
      baseVersion: sha(original),
    });
    expect(response).toEqual({
      ok: true,
      result: {
        path: 'package.json',
        size: 33,
        version: sha('{"name":"rallly","private":true}\n'),
      },
    });
  });

  it('refuses, and changes nothing, when the file changed meanwhile (an edit in the terminal)', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"changed in the terminal"}\n');
    const response = await ask({
      op: 'write',
      path: 'package.json',
      content: 'mine',
      encoding: 'utf8',
      baseVersion: sha(original),
    });
    expectError(response, 'conflict');
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(
      '{"name":"changed in the terminal"}\n',
    );
  });

  it('with a null base, creates a new file but never overwrites one that appeared', async () => {
    const created = await ask({
      op: 'write',
      path: 'src/new.ts',
      content: 'x',
      encoding: 'utf8',
      baseVersion: null,
    });
    expect(created).toMatchObject({ ok: true, result: { version: sha('x') } });
    expectError(
      await ask({
        op: 'write',
        path: 'src/new.ts',
        content: 'y',
        encoding: 'utf8',
        baseVersion: null,
      }),
      'conflict',
    );
    expect(await readFile(join(root, 'src', 'new.ts'), 'utf8')).toBe('x');
  });

  it('refuses a file deleted meanwhile, and a base that is not a version', async () => {
    await rm(join(root, 'package.json'));
    expectError(
      await ask({
        op: 'write',
        path: 'package.json',
        content: 'x',
        encoding: 'utf8',
        baseVersion: sha(original),
      }),
      'conflict',
    );
    expectError(
      await ask({ op: 'write', path: 'a.ts', content: 'x', encoding: 'utf8', baseVersion: 'abc' }),
      'invalid_request',
    );
  });

  it('lets only one of two saves from the same version win', async () => {
    const save = (content: string) =>
      ask({
        op: 'write',
        path: 'package.json',
        content,
        encoding: 'utf8',
        baseVersion: sha(original),
      });
    const results = await Promise.all([save('first'), save('second')]);
    expect(results.filter((response) => response.ok)).toHaveLength(1);
    expect(results.filter((response) => !response.ok)).toHaveLength(1);
  });

  it('still never writes a .env file or through a link', async () => {
    expectError(
      await ask({ op: 'write', path: '.env', content: 'x', encoding: 'utf8', baseVersion: null }),
      'secret_file',
    );
    await symlink(join(base, 'outside.txt'), join(root, 'out.txt'));
    const response = await ask({
      op: 'write',
      path: 'out.txt',
      content: 'x',
      encoding: 'utf8',
      baseVersion: null,
    });
    expect(response.ok).toBe(false);
    expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('CANARY-outside\n');
  });
});

describe('files', () => {
  it('without git, lists every file outside the ignored folders, never a .env file', async () => {
    await mkdir(join(root, 'node_modules', 'react'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'react', 'index.js'), '');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'out.js'), '');
    await writeFile(join(root, 'src', '.env.local'), 'CANARY-local');
    const response = await ask({ op: 'files' });
    expect(response).toEqual({
      ok: true,
      result: {
        files: ['.env.example', 'package.json', 'src/index.ts'],
        truncated: false,
        source: 'walk',
      },
    });
    expect(JSON.stringify(response)).not.toContain('CANARY');
  });

  it('in a git repository: tracked and untracked files, not ignored or deleted ones', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], {
        cwd: root,
      });
    git('init', '-q');
    await writeFile(join(root, '.gitignore'), 'generated/\n');
    await writeFile(join(root, 'old.ts'), 'gone soon');
    git('add', '.gitignore', 'package.json', 'src/index.ts', 'old.ts');
    git('commit', '-q', '-m', 'start');
    await rm(join(root, 'old.ts'));
    await writeFile(join(root, 'untracked.ts'), '');
    await mkdir(join(root, 'generated'));
    await writeFile(join(root, 'generated', 'skip.ts'), '');
    expect(await ask({ op: 'files' })).toEqual({
      ok: true,
      result: {
        files: ['.env.example', '.gitignore', 'package.json', 'src/index.ts', 'untracked.ts'],
        truncated: false,
        source: 'git',
      },
    });
  });
});

describe('journal', () => {
  let clock: number;
  let journal: string;

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 7, 12);
    journal = join(base, '.flowcanvas', 'journal');
    agent = createAgent({ root, journal, now: () => clock });
  });

  const put = (
    path: string,
    content: string,
    revision: number,
    baseVersion: string | null = null,
  ) => ask({ op: 'journal-put', path, content, baseVersion, revision });

  it('keeps unsaved changes outside the project, and gives them back', async () => {
    expect(await put('src/index.ts', 'export const draft = 1;\n', 3, sha('export {};\n'))).toEqual({
      ok: true,
      result: { path: 'src/index.ts', revision: 3 },
    });
    expect(await ask({ op: 'journal-list' })).toEqual({
      ok: true,
      result: {
        entries: [
          {
            path: 'src/index.ts',
            baseVersion: sha('export {};\n'),
            revision: 3,
            updatedAt: clock,
            size: 24,
          },
        ],
      },
    });
    expect(await ask({ op: 'journal-get', path: 'src/index.ts' })).toMatchObject({
      result: { content: 'export const draft = 1;\n', revision: 3 },
    });
    // The project's own files are untouched, and nothing of the journal is inside the project.
    expect(await readFile(join(root, 'src', 'index.ts'), 'utf8')).toBe('export {};\n');
    const listed = await ask({ op: 'files' });
    expect(listed.ok).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('flowcanvas');
    expect(await readdir(journal)).toHaveLength(1);
  });

  it('survives the agent restarting (it lives on disk)', async () => {
    await put('src/index.ts', 'draft', 1);
    const restarted = createAgent({ root, journal });
    expect(await answer(restarted, { op: 'journal-get', path: 'src/index.ts' })).toMatchObject({
      result: { content: 'draft' },
    });
  });

  it('never lets an older put replace newer edits', async () => {
    await put('src/index.ts', 'newer', 5);
    expect(await put('src/index.ts', 'older, arrived late', 4)).toEqual({
      ok: true,
      result: { path: 'src/index.ts', revision: 5 },
    });
    expect(await ask({ op: 'journal-get', path: 'src/index.ts' })).toMatchObject({
      result: { content: 'newer' },
    });
  });

  it('drops an entry after a save, but keeps edits made after that save', async () => {
    await put('src/index.ts', 'typed after saving', 8);
    expect(await ask({ op: 'journal-drop', path: 'src/index.ts', revision: 7 })).toEqual({
      ok: true,
      result: { path: 'src/index.ts', dropped: false },
    });
    expect(await ask({ op: 'journal-drop', path: 'src/index.ts', revision: 8 })).toEqual({
      ok: true,
      result: { path: 'src/index.ts', dropped: true },
    });
    expectError(await ask({ op: 'journal-get', path: 'src/index.ts' }), 'not_found');
    expect(await ask({ op: 'journal-list' })).toEqual({ ok: true, result: { entries: [] } });
  });

  it('never journals a .env file or a path outside the project', async () => {
    const response = await put('.env', 'CANARY-journal', 1);
    expectError(response, 'secret_file');
    expectError(await put('../outside.txt', 'x', 1), 'outside_project');
    expectError(await put('', 'x', 1), 'is_a_directory');
    await expect(readdir(journal)).rejects.toThrow();
  });

  it('skips damaged or misplaced entries instead of showing them as work', async () => {
    await put('src/index.ts', 'real', 1);
    await writeFile(join(journal, `${'0'.repeat(64)}.json`), '{"broken"');
    await writeFile(
      join(journal, `${'1'.repeat(64)}.json`),
      JSON.stringify({
        path: 'src/index.ts',
        baseVersion: null,
        revision: 9,
        updatedAt: 0,
        content: 'misplaced',
      }),
    );
    expect(await ask({ op: 'journal-list' })).toMatchObject({
      result: { entries: [{ path: 'src/index.ts', revision: 1 }] },
    });
  });

  it('refuses too much: over 1 MB, or too many unsaved files', async () => {
    expectError(await put('big.ts', 'x'.repeat(LIMITS.fileBytes + 1), 1), 'too_large');
    for (let i = 0; i < LIMITS.journalEntries; i++) await put(`f${String(i)}.ts`, 'x', 1);
    expectError(await put('one-more.ts', 'x', 1), 'too_large');
    // An existing entry can still be updated.
    expect(await put('f0.ts', 'y', 2)).toMatchObject({ ok: true });
  });

  it('checks its requests', async () => {
    expectError(
      await ask({ op: 'journal-put', path: 'a.ts', content: 'x', revision: -1 }),
      'invalid_request',
    );
    expectError(
      await ask({ op: 'journal-put', path: 'a.ts', content: 7, revision: 1 }),
      'invalid_request',
    );
    expectError(await ask({ op: 'journal-drop', path: 'a.ts' }), 'invalid_request');
  });
});

describe('exec', () => {
  it('runs a command in the project and returns its output and exit code', async () => {
    expect(
      await ask({
        op: 'exec',
        command: ['node', '-e', 'console.log(process.cwd()); process.exit(3)'],
        cwd: 'src',
      }),
    ).toMatchObject({
      ok: true,
      result: {
        exitCode: 3,
        stdout: `${join(root, 'src')}\n`,
        stderr: '',
        timedOut: false,
        truncated: false,
      },
    });
  });

  it('uses no shell, so nothing in the arguments is interpreted', async () => {
    expect(
      await ask({ op: 'exec', command: ['echo', '$(id -u) `whoami`; rm -rf /'], cwd: '' }),
    ).toMatchObject({
      result: { stdout: '$(id -u) `whoami`; rm -rf /\n', exitCode: 0 },
    });
  });

  it('stops a command at its time limit, with everything it started', async () => {
    const response = await ask({
      op: 'exec',
      command: ['sh', '-c', 'sleep 30 & sleep 30'],
      cwd: '',
      timeoutMs: 200,
    });
    expect(response).toMatchObject({ result: { timedOut: true, signal: 'SIGKILL' } });
    if (response.ok && 'durationMs' in response.result)
      expect(response.result.durationMs).toBeLessThan(5000);
  });

  it('keeps at most 1 MiB of each output', async () => {
    const response = await ask({
      op: 'exec',
      command: [
        'node',
        '-e',
        `process.stdout.write('x'.repeat(${String(LIMITS.execOutputBytes + 10)}))`,
      ],
      cwd: '',
    });
    expect(response).toMatchObject({ result: { truncated: true } });
    if (response.ok && 'stdout' in response.result)
      expect(response.result.stdout.length).toBe(LIMITS.execOutputBytes);
  });

  it('says so for a missing program or a folder outside the project', async () => {
    expectError(await ask({ op: 'exec', command: ['no-such-program'], cwd: '' }), 'not_found');
    expectError(await ask({ op: 'exec', command: ['ls'], cwd: '..' }), 'outside_project');
    expectError(await ask({ op: 'exec', command: ['ls'], cwd: 'package.json' }), 'not_a_directory');
  });
});

describe('requests', () => {
  it('refuses anything malformed with a sentence', async () => {
    for (const body of [
      null,
      { op: 'delete', path: 'x' },
      { op: 'read', path: 5 },
      { op: 'read' },
      { op: 'read', path: 'a\0b' },
      { op: 'read', path: 'x'.repeat(LIMITS.pathLength + 1) },
      { op: 'write', path: 'x', content: 5 },
      { op: 'write', path: 'x', content: 'x', encoding: 'latin1' },
      { op: 'exec', command: 'git status', cwd: '' },
      { op: 'exec', command: [], cwd: '' },
      { op: 'exec', command: [''], cwd: '' },
      { op: 'exec', command: ['ls'], cwd: '', timeoutMs: LIMITS.execTimeoutMs + 1 },
      { op: 'exec', command: ['ls'], cwd: '', timeoutMs: 1.5 },
    ]) {
      expectError(await ask(body), 'invalid_request');
    }
  });

  it('says hello with its protocol version', async () => {
    expect(await ask({ op: 'hello' })).toEqual({
      ok: true,
      result: { protocol: AGENT_PROTOCOL, node: process.version },
    });
  });
});

describe('serve', () => {
  it('answers line by line, matching ids, and refuses other protocol versions', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = serve(agent, input, output);
    const lines: unknown[] = [];
    output.on('data', (chunk: Buffer) => {
      for (const line of chunk
        .toString()
        .split('\n')
        .filter((l) => l !== ''))
        lines.push(JSON.parse(line));
    });
    input.write(`${JSON.stringify({ v: 2, id: 7, body: { op: 'read', path: 'package.json' } })}\n`);
    input.write(`${JSON.stringify({ v: 1, id: 8, body: { op: 'hello' } })}\n`);
    input.write('not json\n');
    input.end();
    await done;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toEqual(
      expect.arrayContaining([
        { v: 2, id: 7, body: expect.objectContaining({ ok: true }) as unknown },
        {
          v: 2,
          id: 8,
          body: {
            ok: false,
            error: { code: 'invalid_request', message: 'This agent speaks protocol 2.' },
          },
        },
        {
          v: 2,
          id: 0,
          body: {
            ok: false,
            error: { code: 'invalid_request', message: 'Send one JSON message per line.' },
          },
        },
      ]),
    );
  });
});

describe('isSecretFile', () => {
  it('matches .env and .dev.vars files, not their examples', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.dev.vars',
      '.dev.vars.staging',
    ]) {
      expect(isSecretFile(name), name).toBe(true);
    }
    for (const name of [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.dev.vars.example',
      'env.ts',
      '.envrc',
      'x.env',
    ]) {
      expect(isSecretFile(name), name).toBe(false);
    }
  });
});
