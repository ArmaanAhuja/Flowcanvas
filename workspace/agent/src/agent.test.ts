import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answer, createAgent, serve, type Agent } from './agent.js';
import { AGENT_PROTOCOL, LIMITS, isSecretFile, type AgentResponse } from './protocol.js';

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
      result: { path: 'package.json', size: 18, encoding: 'utf8', content: '{"name":"rallly"}\n' },
    });
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0xff]));
    expect(await ask({ op: 'read', path: 'logo.png' })).toMatchObject({
      result: { encoding: 'base64', content: 'iVAA/w==' },
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
      result: { path: 'notes/today.md', size: 5 },
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
    input.write(`${JSON.stringify({ v: 1, id: 7, body: { op: 'read', path: 'package.json' } })}\n`);
    input.write(`${JSON.stringify({ v: 2, id: 8, body: { op: 'hello' } })}\n`);
    input.write('not json\n');
    input.end();
    await done;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toEqual(
      expect.arrayContaining([
        { v: 1, id: 7, body: expect.objectContaining({ ok: true }) as unknown },
        {
          v: 1,
          id: 8,
          body: {
            ok: false,
            error: { code: 'invalid_request', message: 'This agent speaks protocol 1.' },
          },
        },
        {
          v: 1,
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
