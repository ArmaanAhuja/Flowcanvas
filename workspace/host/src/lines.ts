// A JSON-lines connection to a process inside a workspace (ADR 0016): requests out on stdin, answers in on
// stdout, matched by id. Shared by the agent (phase 1d) and the engine (phase 4, ADR 0025). The process runs
// as the workspace's own user, so every answer is checked like any other untrusted input.
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { HostError } from './errors.js';

/** What the host needs from a process in a workspace; a test passes a local process instead of docker exec. */
export interface WorkspaceProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  kill(): void;
  onExit(listener: () => void): void;
}

export interface LineProtocol<Request, Response> {
  readonly version: number;
  /** Longest answer line accepted. */
  readonly maxLineBytes: number;
  /** How long to wait for the answer to `request`. */
  timeoutMs(request: Request): number;
  /** Whether `body` is a valid answer to `request`. */
  check(request: Request, body: unknown): body is Response;
  readonly messages: {
    readonly stopped: string;
    readonly noAnswer: string;
    readonly badAnswer: string;
  };
}

interface Pending<Request, Response> {
  readonly request: Request;
  readonly resolve: (response: Response) => void;
  readonly reject: (error: HostError) => void;
  readonly timer: NodeJS.Timeout;
}

export class LineConnection<Request, Response> {
  readonly #process: WorkspaceProcess;
  readonly #protocol: LineProtocol<Request, Response>;
  readonly #pending = new Map<number, Pending<Request, Response>>();
  #nextId = 1;
  #closed = false;

  constructor(
    process: WorkspaceProcess,
    protocol: LineProtocol<Request, Response>,
    onClose: () => void,
  ) {
    this.#process = process;
    this.#protocol = protocol;
    const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      this.#receive(line);
    });
    // The process has gone: by its exit, or by a write to its stdin failing first (EPIPE when it has just exited).
    // Without an error listener, that failed write was an uncaught exception, which would end the host (found by
    // CI, phase 4). Either way, once: every waiting request fails with "stopped", and the connection is closed.
    const stopped = () => {
      if (this.#closed) return;
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new HostError('failed', protocol.messages.stopped));
      }
      this.#pending.clear();
      onClose();
    };
    process.stdin.on('error', stopped);
    process.onExit(stopped);
  }

  get closed() {
    return this.#closed;
  }

  #receive(line: string): void {
    let envelope: { v?: unknown; id?: unknown; body?: unknown };
    try {
      envelope =
        line.length > this.#protocol.maxLineBytes
          ? {}
          : (JSON.parse(line) as { v?: unknown; id?: unknown; body?: unknown });
    } catch {
      return;
    }
    const id = envelope.id;
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined;
    if (pending === undefined || typeof id !== 'number') return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (
      envelope.v === this.#protocol.version &&
      this.#protocol.check(pending.request, envelope.body)
    ) {
      pending.resolve(envelope.body);
    } else {
      pending.reject(new HostError('failed', this.#protocol.messages.badAnswer));
    }
  }

  call(request: Request): Promise<Response> {
    if (this.#closed) {
      return Promise.reject(new HostError('failed', this.#protocol.messages.stopped));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new HostError('failed', this.#protocol.messages.noAnswer));
      }, this.#protocol.timeoutMs(request));
      this.#pending.set(id, { request, resolve, reject, timer });
      this.#process.stdin.write(
        `${JSON.stringify({ v: this.#protocol.version, id, body: request })}\n`,
      );
    });
  }

  close(): void {
    this.#process.kill();
  }
}

/**
 * One connection per workspace, started on first use and again after the process stops. `ready` checks a
 * new connection (its protocol version) before anything else is sent on it.
 */
export class LineConnections<Request, Response> {
  readonly #start: (ref: string) => Promise<WorkspaceProcess>;
  readonly #protocol: LineProtocol<Request, Response>;
  readonly #ready: (connection: LineConnection<Request, Response>) => Promise<void>;
  readonly #connections = new Map<string, Promise<LineConnection<Request, Response>>>();

  constructor(
    start: (ref: string) => Promise<WorkspaceProcess>,
    protocol: LineProtocol<Request, Response>,
    ready: (connection: LineConnection<Request, Response>) => Promise<void>,
  ) {
    this.#start = start;
    this.#protocol = protocol;
    this.#ready = ready;
  }

  async call(ref: string, request: Request): Promise<Response> {
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

  async #connect(ref: string): Promise<LineConnection<Request, Response>> {
    const existing = this.#connections.get(ref);
    if (existing !== undefined) {
      const connection = await existing.catch(() => undefined);
      if (connection !== undefined && !connection.closed) return connection;
      this.#connections.delete(ref);
    }
    const connecting = (async () => {
      const connection = new LineConnection(await this.#start(ref), this.#protocol, () => {
        if (this.#connections.get(ref) === connecting) this.#connections.delete(ref);
      });
      try {
        await this.#ready(connection);
      } catch (error) {
        connection.close();
        throw error;
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
