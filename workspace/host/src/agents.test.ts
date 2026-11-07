// The host's agent connections, against the real built agent running as a local process (no Docker).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_DIR } from '@flowcanvas/workspace-agent/files';
import { AGENT_PROTOCOL } from '@flowcanvas/workspace-agent/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agents, MESSAGES, type AgentProcess, type StartAgent } from './agents.js';
import { HostError } from './errors.js';

let root: string;
let started: number;
let processes: AgentProcess[];

/** Starts the built agent with `root` as its project, as docker exec would inside a workspace. */
const local: StartAgent = () => {
  started += 1;
  const agentUrl = new URL('agent.js', AGENT_DIR).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createAgent, serve } from ${JSON.stringify(agentUrl)};
       await serve(createAgent({ root: ${JSON.stringify(root)} }), process.stdin, process.stdout);`,
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const agentProcess: AgentProcess = {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => child.kill(),
    onExit: (listener) => child.on('exit', listener),
  };
  processes.push(agentProcess);
  return Promise.resolve(agentProcess);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fc-agents-'));
  await writeFile(join(root, 'package.json'), '{"name":"rallly"}\n');
  started = 0;
  processes = [];
});

afterEach(async () => {
  for (const agentProcess of processes) agentProcess.kill();
  await rm(root, { recursive: true, force: true });
});

describe('Agents', () => {
  it('starts an agent once and reuses its connection', async () => {
    const agents = new Agents(local);
    expect(await agents.call('ws', { op: 'read', path: 'package.json' })).toMatchObject({
      ok: true,
      result: { content: '{"name":"rallly"}\n' },
    });
    await agents.call('ws', { op: 'list', path: '' });
    expect(started).toBe(1);
  });

  it('answers requests side by side, each with its own answer', async () => {
    const agents = new Agents(local);
    const slow = agents.call('ws', {
      op: 'exec',
      command: ['sleep', '0.3'],
      cwd: '',
      timeoutMs: 5000,
    });
    const quick = agents.call('ws', { op: 'read', path: 'package.json' });
    expect(await quick).toMatchObject({ ok: true, result: { path: 'package.json' } });
    expect(await slow).toMatchObject({ ok: true, result: { exitCode: 0 } });
  });

  it('starts a new agent after the old one stopped', async () => {
    const agents = new Agents(local);
    await agents.call('ws', { op: 'hello' });
    processes[0]?.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await agents.call('ws', { op: 'hello' })).toMatchObject({ ok: true });
    expect(started).toBe(2);
  });

  it('fails the waiting requests when the agent stops, and closes on request', async () => {
    const agents = new Agents(local);
    await agents.call('ws', { op: 'hello' });
    const waiting = agents.call('ws', {
      op: 'exec',
      command: ['sleep', '5'],
      cwd: '',
      timeoutMs: 10_000,
    });
    agents.close('ws');
    await expect(waiting).rejects.toEqual(new HostError('failed', MESSAGES.stopped));
  });

  it('refuses an agent that speaks another version, or answers nonsense', async () => {
    const liar: StartAgent = async (ref) => {
      const real = await local(ref);
      // Rewrite every answer to claim the next protocol version.
      const { PassThrough } = await import('node:stream');
      const out = new PassThrough();
      real.stdout.on('data', (chunk: Buffer) =>
        out.write(
          chunk
            .toString()
            .replace(
              `"protocol":${String(AGENT_PROTOCOL)}`,
              `"protocol":${String(AGENT_PROTOCOL + 1)}`,
            ),
        ),
      );
      return { ...real, stdout: out };
    };
    await expect(new Agents(liar).call('ws', { op: 'hello' })).rejects.toEqual(
      new HostError('failed', MESSAGES.wrongVersion),
    );
  });
});
