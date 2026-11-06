// The workspace agent (phase 1d step 5): runs inside the workspace container as the workspace's own user and
// answers file and process requests about the project. It can't do anything the workspace's user can't, so
// the host and the control plane treat its answers as untrusted.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  AGENT_PROTOCOL,
  AgentProblem,
  LIMITS,
  isSecretFile,
  parseAgentRequest,
  type AgentRequest,
  type AgentResponse,
  type AgentResult,
  type Entry,
  type Envelope,
  type Results,
} from './protocol.js';

const SECRET_MESSAGE =
  'Secrets live in the project’s vault, not in .env files, so they can’t be opened here.';

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

export interface Agent {
  handle(request: AgentRequest): Promise<AgentResult>;
}

export function createAgent(options: { root: string }): Agent {
  const root = resolve(options.root);
  let realRoot: string | undefined;

  async function projectRoot(): Promise<string> {
    try {
      realRoot ??= await realpath(root);
      return realRoot;
    } catch {
      throw new AgentProblem('not_found', 'This workspace has no project files yet.');
    }
  }

  function isInside(base: string, target: string): boolean {
    return target === base || target.startsWith(base + sep);
  }

  /** The absolute path for a project-relative one, refusing anything that leaves the project. */
  async function locate(path: string): Promise<{ target: string; shown: string }> {
    const base = await projectRoot();
    const target = resolve(base, path === '' ? '.' : path);
    if (!isInside(base, target)) {
      throw new AgentProblem('outside_project', 'That path is outside the project.');
    }
    return { target, shown: relative(base, target) };
  }

  /** Follows links for an existing path, and refuses one that ends up outside the project. */
  async function real(target: string): Promise<string> {
    let resolved: string;
    try {
      resolved = await realpath(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new AgentProblem('not_found', 'There’s nothing at that path.');
      throw error;
    }
    if (!isInside(await projectRoot(), resolved)) {
      throw new AgentProblem('outside_project', 'That link points outside the project.');
    }
    return resolved;
  }

  async function list(path: string): Promise<Results['list']> {
    const { target, shown } = await locate(path);
    const directory = await real(target);
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOTDIR')
        throw new AgentProblem('not_a_directory', 'That’s a file, not a folder.');
      throw error;
    }
    const entries: Entry[] = [];
    for (const dirent of names.slice(0, LIMITS.entries)) {
      const stats = await lstat(resolve(directory, dirent.name)).catch(() => undefined);
      entries.push({
        name: dirent.name,
        type: dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : dirent.isSymbolicLink()
              ? 'symlink'
              : 'other',
        size: dirent.isFile() ? (stats?.size ?? 0) : 0,
        secret: isSecretFile(dirent.name),
      });
    }
    entries.sort((a, b) =>
      a.type === b.type || (a.type !== 'directory' && b.type !== 'directory')
        ? a.name.localeCompare(b.name)
        : a.type === 'directory'
          ? -1
          : 1,
    );
    return { path: shown, entries, truncated: names.length > LIMITS.entries };
  }

  async function read(path: string): Promise<Results['read']> {
    const { target, shown } = await locate(path);
    if (isSecretFile(basename(target))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const file = await real(target);
    if (isSecretFile(basename(file))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const stats = await lstat(file);
    if (stats.isDirectory())
      throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
    if (!stats.isFile())
      throw new AgentProblem('not_allowed', 'Only ordinary files can be opened.');
    if (stats.size > LIMITS.fileBytes)
      throw new AgentProblem('too_large', 'Files over 1 MB can’t be opened here yet.');
    const bytes = await readFile(file);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.includes('\0'))
        return { path: shown, size: bytes.length, encoding: 'utf8', content: text };
    } catch {
      // Not UTF-8: sent as base64 below.
    }
    return {
      path: shown,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
    };
  }

  async function write(
    path: string,
    content: string,
    encoding: 'utf8' | 'base64',
  ): Promise<Results['write']> {
    const { target, shown } = await locate(path);
    if (target === (await projectRoot()))
      throw new AgentProblem('is_a_directory', 'Give a file’s path.');
    if (isSecretFile(basename(target))) throw new AgentProblem('secret_file', SECRET_MESSAGE);
    const bytes =
      encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    if (bytes.length > LIMITS.fileBytes)
      throw new AgentProblem('too_large', 'Keep files under 1 MB.');

    // The nearest folder that exists must really be inside the project (no link out), then make the rest.
    let existing = dirname(target);
    while (
      !(await lstat(existing).then(
        () => true,
        () => false,
      ))
    )
      existing = dirname(existing);
    if (!(await lstat(await real(existing))).isDirectory()) {
      throw new AgentProblem('not_a_directory', 'Part of that path is a file.');
    }
    await mkdir(dirname(target), { recursive: true });
    await real(dirname(target));

    let handle;
    try {
      // O_NOFOLLOW: never write through a link, even one made after the checks above.
      handle = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o644,
      );
    } catch (error) {
      if (errorCode(error) === 'ELOOP')
        throw new AgentProblem('not_allowed', 'That’s a link; open the file it points to.');
      if (errorCode(error) === 'EISDIR')
        throw new AgentProblem('is_a_directory', 'That’s a folder, not a file.');
      if (errorCode(error) === 'ENOTDIR')
        throw new AgentProblem('not_a_directory', 'Part of that path is a file.');
      throw error;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return { path: shown, size: bytes.length };
  }

  async function exec(
    command: readonly string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<Results['exec']> {
    const { target } = await locate(cwd);
    const directory = await real(target);
    if (!(await lstat(directory)).isDirectory())
      throw new AgentProblem('not_a_directory', 'Run it in a folder.');
    const [program = '', ...args] = command;
    const started = Date.now();
    return new Promise((done, fail) => {
      // No shell: the command is a list of arguments, so nothing in it is interpreted. Its own process group,
      // so a time-out stops everything it started.
      const child = spawn(program, args, {
        cwd: directory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = {
        stdout: [] as Buffer[],
        stderr: [] as Buffer[],
        sizes: { stdout: 0, stderr: 0 },
      };
      let truncated = false;
      let timedOut = false;
      for (const stream of ['stdout', 'stderr'] as const) {
        child[stream].on('data', (chunk: Buffer) => {
          const room = LIMITS.execOutputBytes - output.sizes[stream];
          if (chunk.length > room) truncated = true;
          if (room > 0) {
            output[stream].push(chunk.subarray(0, room));
            output.sizes[stream] += Math.min(room, chunk.length);
          }
        });
      }
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        fail(
          errorCode(error) === 'ENOENT'
            ? new AgentProblem(
                'not_found',
                `There’s no program called ${program.slice(0, 100)} here.`,
              )
            : error,
        );
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        done({
          exitCode,
          signal,
          stdout: Buffer.concat(output.stdout).toString('utf8'),
          stderr: Buffer.concat(output.stderr).toString('utf8'),
          truncated,
          timedOut,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  return {
    handle(request) {
      switch (request.op) {
        case 'hello':
          return Promise.resolve({ protocol: AGENT_PROTOCOL, node: process.version });
        case 'list':
          return list(request.path);
        case 'read':
          return read(request.path);
        case 'write':
          return write(request.path, request.content, request.encoding);
        case 'exec':
          return exec(request.command, request.cwd, request.timeoutMs);
      }
    },
  };
}

/** Answers one request; every failure becomes an error response with a sentence that's safe to show. */
export async function answer(agent: Agent, body: unknown): Promise<AgentResponse> {
  try {
    return { ok: true, result: await agent.handle(parseAgentRequest(body)) };
  } catch (error) {
    if (error instanceof AgentProblem)
      return { ok: false, error: { code: error.code, message: error.message } };
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        error: { code: 'not_allowed', message: 'The workspace isn’t allowed to do that.' },
      };
    }
    return {
      ok: false,
      error: { code: 'failed', message: 'That didn’t work in the workspace. Try again.' },
    };
  }
}

/** Reads requests line by line and writes each response as a line, in whatever order they finish. */
export function serve(agent: Agent, input: Readable, output: Writable): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const send = (envelope: Envelope<AgentResponse>) => output.write(`${JSON.stringify(envelope)}\n`);
  lines.on('line', (line) => {
    let id = 0;
    void (async () => {
      let body: unknown;
      try {
        if (line.length > LIMITS.lineBytes)
          throw new AgentProblem('too_large', 'That request is too large.');
        const envelope = JSON.parse(line) as Partial<Envelope<unknown>>;
        id = typeof envelope.id === 'number' && Number.isSafeInteger(envelope.id) ? envelope.id : 0;
        if (envelope.v !== AGENT_PROTOCOL) {
          throw new AgentProblem(
            'invalid_request',
            `This agent speaks protocol ${String(AGENT_PROTOCOL)}.`,
          );
        }
        body = envelope.body;
      } catch (error) {
        const message =
          error instanceof AgentProblem ? error.message : 'Send one JSON message per line.';
        send({
          v: AGENT_PROTOCOL,
          id,
          body: { ok: false, error: { code: 'invalid_request', message } },
        });
        return;
      }
      send({ v: AGENT_PROTOCOL, id, body: await answer(agent, body) });
    })();
  });
  return new Promise((done) => lines.on('close', done));
}
