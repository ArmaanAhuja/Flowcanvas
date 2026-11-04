// Connections to the workspace agent inside each running workspace (phase 1d step 5): one long-lived
// `docker exec -i` per workspace, JSON lines both ways (ADR 0016). The agent runs as the workspace's own user,
// so its answers are checked like any other untrusted input.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  AGENT_PROTOCOL,
  LIMITS,
  isAgentResponse,
  type AgentRequest,
  type AgentResponse,
  type Envelope,
} from '@flowcanvas/workspace-agent/protocol';
import { AGENT_DIR, AGENT_FILES } from '@flowcanvas/workspace-agent/files';
import type { Docker } from './docker-cli.js';
import { HostError } from './errors.js';

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
export interface AgentProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  kill(): void;
  onExit(listener: () => void): void;
}

export type StartAgent = (ref: string) => Promise<AgentProcess>;

/** Copies the built agent into the workspace and starts it with `docker exec -i`. */
export function dockerAgent(docker: Docker): StartAgent {
  return async (ref) => {
    for (const name of AGENT_FILES) {
      const source = await readFile(new URL(name, AGENT_DIR), 'utf8');
      // The names are our own constants; the content goes in on stdin, never on the command line.
      await docker(
        ['exec', '-i', ref, 'sh', '-c', `mkdir -p ${AGENT_HOME} && cat > ${AGENT_HOME}/${name}`],
        {
          input: source,
        },
      );
    }
    const child = spawn('docker', ['exec', '-i', ref, 'node', `${AGENT_HOME}/main.js`], {
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

interface Pending {
  readonly resolve: (response: AgentResponse) => void;
  readonly reject: (error: HostError) => void;
  readonly timer: NodeJS.Timeout;
}

class Connection {
  readonly #process: AgentProcess;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;

  constructor(process: AgentProcess, onClose: () => void) {
    this.#process = process;
    const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      this.#receive(line);
    });
    process.onExit(() => {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new HostError('failed', MESSAGES.stopped));
      }
      this.#pending.clear();
      onClose();
    });
  }

  get closed() {
    return this.#closed;
  }

  #receive(line: string): void {
    let envelope: Partial<Envelope<unknown>>;
    try {
      envelope =
        line.length > LIMITS.lineBytes ? {} : (JSON.parse(line) as Partial<Envelope<unknown>>);
    } catch {
      return;
    }
    const id = envelope.id;
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined;
    if (pending === undefined || typeof id !== 'number') return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (envelope.v === AGENT_PROTOCOL && isAgentResponse(envelope.body))
      pending.resolve(envelope.body);
    else pending.reject(new HostError('failed', MESSAGES.badAnswer));
  }

  call(request: AgentRequest): Promise<AgentResponse> {
    if (this.#closed) return Promise.reject(new HostError('failed', MESSAGES.stopped));
    const id = this.#nextId++;
    const timeoutMs = (request.op === 'exec' ? request.timeoutMs : DEFAULT_TIMEOUT_MS) + GRACE_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new HostError('failed', MESSAGES.noAnswer));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      const envelope: Envelope<AgentRequest> = { v: AGENT_PROTOCOL, id, body: request };
      this.#process.stdin.write(`${JSON.stringify(envelope)}\n`);
    });
  }

  close(): void {
    this.#process.kill();
  }
}

/** One agent connection per workspace, started on first use and again after the agent stops. */
export class Agents {
  readonly #start: StartAgent;
  readonly #connections = new Map<string, Promise<Connection>>();

  constructor(start: StartAgent) {
    this.#start = start;
  }

  async call(ref: string, request: AgentRequest): Promise<AgentResponse> {
    return (await this.#connect(ref)).call(request);
  }

  /** Ends the connection, e.g. when the workspace stops. */
  close(ref: string): void {
    const connection = this.#connections.get(ref);
    this.#connections.delete(ref);
    void connection?.then(
      (c) => {
        c.close();
      },
      () => undefined,
    );
  }

  async #connect(ref: string): Promise<Connection> {
    const existing = this.#connections.get(ref);
    if (existing !== undefined) {
      const connection = await existing.catch(() => undefined);
      if (connection !== undefined && !connection.closed) return connection;
      this.#connections.delete(ref);
    }
    const connecting = (async () => {
      const connection = new Connection(await this.#start(ref), () => {
        if (this.#connections.get(ref) === connecting) this.#connections.delete(ref);
      });
      const hello = await connection.call({ op: 'hello' });
      if (!hello.ok || !('protocol' in hello.result) || hello.result.protocol !== AGENT_PROTOCOL) {
        connection.close();
        throw new HostError('failed', MESSAGES.wrongVersion);
      }
      return connection;
    })();
    this.#connections.set(ref, connecting);
    try {
      return await connecting;
    } catch (error) {
      if (this.#connections.get(ref) === connecting) this.#connections.delete(ref);
      throw error;
    }
  }
}
