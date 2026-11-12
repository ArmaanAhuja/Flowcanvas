// The engine in each running workspace (phase 4 step 3, ADR 0025): copied in as one bundled script and its
// WebAssembly, started with `docker exec -i`, and kept running while the workspace runs. It indexes the project,
// follows its changes, and answers status and search, JSON lines both ways like the agent.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  ENGINE_BUNDLE_DIR,
  ENGINE_BUNDLE_FILES,
  ENGINE_BUNDLE_VERSION_FILE,
  ENGINE_TYPESCRIPT_ARCHIVE,
} from '@flowcanvas/engine/bundle';
import {
  ENGINE_HOME,
  ENGINE_LIMITS,
  ENGINE_PROTOCOL,
  isEngineResponse,
  TYPESCRIPT_OPS,
  type EngineRequest,
  type EngineResponse,
} from '@flowcanvas/engine/protocol';
import type { Docker } from './docker-cli.js';
import { HostError } from './errors.js';
import { LineConnections, type LineProtocol, type WorkspaceProcess } from './lines.js';

export const ENGINE_MESSAGES = {
  stopped: 'The project index stopped. Reopen the project to start it again.',
  noAnswer: 'The project index didn’t answer in time. Try again.',
  badAnswer: 'The project index gave an answer we didn’t expect.',
  wrongVersion: 'The project index is a different version. Stop the workspace and open it again.',
} as const;

/** Status and search answer from memory and the index; anything slower than this is stuck. */
const TIMEOUT_MS = 15_000;
/** TypeScript's answers (phase 5): the first about a package builds its programs, which can take seconds; the worker
 * gives up at 60 s itself, so this is only a backstop. */
export const SEMANTIC_TIMEOUT_MS = 90_000;

export type StartEngine = (ref: string) => Promise<WorkspaceProcess>;

/** File names are our own constants; content goes in on stdin, never on a command line. */
const copyCommand = (name: string) =>
  `mkdir -p ${ENGINE_HOME} && cat > ${ENGINE_HOME}/${name}.$$ && mv ${ENGINE_HOME}/${name}.$$ ${ENGINE_HOME}/${name}`;

/** TypeScript's archive (phase 5): unpacked into `typescript/`, replacing an older copy, then removed. */
const unpackCommand = (name: string) =>
  `mkdir -p ${ENGINE_HOME} && cat > ${ENGINE_HOME}/${name}.$$ && rm -rf ${ENGINE_HOME}/typescript && mkdir ${ENGINE_HOME}/typescript && tar -xf ${ENGINE_HOME}/${name}.$$ -C ${ENGINE_HOME}/typescript && rm ${ENGINE_HOME}/${name}.$$`;

/**
 * Copies the bundle into the workspace unless the same version is already there. The version file goes in
 * last, so a copy cut short is never taken for a complete one.
 */
async function copyEngine(docker: Docker, ref: string): Promise<void> {
  const version = (
    await readFile(new URL(ENGINE_BUNDLE_VERSION_FILE, ENGINE_BUNDLE_DIR), 'utf8')
  ).trim();
  const there = await docker([
    'exec',
    ref,
    'cat',
    `${ENGINE_HOME}/${ENGINE_BUNDLE_VERSION_FILE}`,
  ]).then(
    (result) => result.stdout.trim(),
    () => '',
  );
  if (there === version) return;
  for (const name of ENGINE_BUNDLE_FILES) {
    const content = await readFile(new URL(name, ENGINE_BUNDLE_DIR));
    const command = name === ENGINE_TYPESCRIPT_ARCHIVE ? unpackCommand(name) : copyCommand(name);
    await docker(['exec', '-i', ref, 'sh', '-c', command], { input: content, timeoutMs: 120_000 });
  }
  await docker(['exec', '-i', ref, 'sh', '-c', copyCommand(ENGINE_BUNDLE_VERSION_FILE)], {
    input: `${version}\n`,
  });
}

/** Copies the engine into the workspace (when needed) and starts it with `docker exec -i`. */
export function dockerEngine(docker: Docker): StartEngine {
  return async (ref) => {
    await copyEngine(docker, ref);
    const child = spawn('docker', ['exec', '-i', ref, 'node', `${ENGINE_HOME}/main.js`], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      kill: () => child.kill(),
      onExit: (listener) => child.on('exit', listener),
    };
  };
}

const engineProtocol: LineProtocol<EngineRequest, EngineResponse> = {
  version: ENGINE_PROTOCOL,
  maxLineBytes: ENGINE_LIMITS.lineBytes,
  timeoutMs: (request) => (TYPESCRIPT_OPS.includes(request.op) ? SEMANTIC_TIMEOUT_MS : TIMEOUT_MS),
  check: (request, body): body is EngineResponse => isEngineResponse(request, body),
  messages: ENGINE_MESSAGES,
};

/** One engine per running workspace, started on first use and again after it stops. */
export class Indexers {
  readonly #connections: LineConnections<EngineRequest, EngineResponse>;

  constructor(start: StartEngine) {
    this.#connections = new LineConnections(start, engineProtocol, async (connection) => {
      const hello = await connection.call({ op: 'hello' });
      if (!hello.ok || !('protocol' in hello.result) || hello.result.protocol !== ENGINE_PROTOCOL) {
        throw new HostError('failed', ENGINE_MESSAGES.wrongVersion);
      }
    });
  }

  call(ref: string, request: EngineRequest): Promise<EngineResponse> {
    return this.#connections.call(ref, request);
  }

  /** Ends the engine, e.g. when the workspace stops. Its index stays in the workspace's volume. */
  close(ref: string): void {
    this.#connections.close(ref);
  }
}
