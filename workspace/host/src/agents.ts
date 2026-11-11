// Connections to the workspace agent inside each running workspace (phase 1d step 5): one long-lived
// `docker exec -i` per workspace, JSON lines both ways (ADR 0016). The agent runs as the workspace's own user,
// so its answers are checked like any other untrusted input.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  AGENT_PROTOCOL,
  LIMITS,
  isAgentResponse,
  type AgentRequest,
  type AgentResponse,
} from '@flowcanvas/workspace-agent/protocol';
import { AGENT_DIR, AGENT_FILES } from '@flowcanvas/workspace-agent/files';
import type { Docker } from './docker-cli.js';
import { HostError } from './errors.js';
import { LineConnections, type LineProtocol, type WorkspaceProcess } from './lines.js';

/** Inside the container. /tmp is a tmpfs, so a restarted container gets a fresh copy. */
export const AGENT_HOME = '/tmp/flowcanvas-agent';

/** Extra time on top of a command's own limit before the host gives up on an answer. */
const GRACE_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export const MESSAGES = {
  stopped: 'The workspace agent stopped. Try again.',
  noAnswer: 'The workspace didn’t answer in time. Try again.',
  badAnswer: 'The workspace gave an answer we didn’t expect.',
  wrongVersion: 'The workspace agent is a different version. Stop the workspace and open it again.',
} as const;

/** What the host needs from a running agent process; a test passes a local process instead of docker exec. */
export type AgentProcess = WorkspaceProcess;

export type StartAgent = (ref: string) => Promise<AgentProcess>;

/**
 * Copies the built agent into the workspace. Each file is written under a temporary name and renamed into place,
 * so the request agent and a watcher copied in at the same moment never start from a half-written file.
 */
async function copyAgent(docker: Docker, ref: string): Promise<void> {
  for (const name of AGENT_FILES) {
    const source = await readFile(new URL(name, AGENT_DIR), 'utf8');
    // The names are our own constants; the content goes in on stdin, never on the command line.
    await docker(
      [
        'exec',
        '-i',
        ref,
        'sh',
        '-c',
        `mkdir -p ${AGENT_HOME} && cat > ${AGENT_HOME}/${name}.$$ && mv ${AGENT_HOME}/${name}.$$ ${AGENT_HOME}/${name}`,
      ],
      { input: source },
    );
  }
}

function startNode(ref: string, args: readonly string[]): AgentProcess {
  const child = spawn('docker', ['exec', '-i', ref, 'node', `${AGENT_HOME}/main.js`, ...args], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => child.kill(),
    onExit: (listener) => child.on('exit', listener),
  };
}

/** Copies the built agent into the workspace and starts it with `docker exec -i`. */
export function dockerAgent(docker: Docker): StartAgent {
  return async (ref) => {
    await copyAgent(docker, ref);
    return startNode(ref, []);
  };
}

/** The project's file watcher (phase 3): the same agent, started with `--watch`, one event per line. */
export function dockerWatcher(docker: Docker): StartAgent {
  return async (ref) => {
    await copyAgent(docker, ref);
    return startNode(ref, ['--watch']);
  };
}

const agentProtocol: LineProtocol<AgentRequest, AgentResponse> = {
  version: AGENT_PROTOCOL,
  maxLineBytes: LIMITS.lineBytes,
  timeoutMs: (request) =>
    (request.op === 'exec' ? request.timeoutMs : DEFAULT_TIMEOUT_MS) + GRACE_MS,
  check: (_request, body): body is AgentResponse => isAgentResponse(body),
  messages: MESSAGES,
};

/** One agent connection per workspace, started on first use and again after the agent stops. */
export class Agents {
  readonly #connections: LineConnections<AgentRequest, AgentResponse>;

  constructor(start: StartAgent) {
    this.#connections = new LineConnections(start, agentProtocol, async (connection) => {
      const hello = await connection.call({ op: 'hello' });
      if (!hello.ok || !('protocol' in hello.result) || hello.result.protocol !== AGENT_PROTOCOL) {
        throw new HostError('failed', MESSAGES.wrongVersion);
      }
    });
  }

  call(ref: string, request: AgentRequest): Promise<AgentResponse> {
    return this.#connections.call(ref, request);
  }

  /** Ends the connection, e.g. when the workspace stops. */
  close(ref: string): void {
    this.#connections.close(ref);
  }
}
