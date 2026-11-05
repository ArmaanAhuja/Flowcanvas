// An in-memory WorkspaceProvider for lifecycle and route tests: no Docker, no network.
import type { AgentRequest, AgentResponse } from '@flowcanvas/workspace-agent/protocol';
import {
  ProviderError,
  type PressureKind,
  type TerminalSocket,
  type WorkspaceProvider,
} from '../workspaces/provider.js';

type Method = 'create' | 'start' | 'pause' | 'resume' | 'stop' | 'agent' | 'terminal';
type FakeState = 'running' | 'paused' | 'stopped';

export class FakeProvider implements WorkspaceProvider {
  readonly name = 'fake';
  /** What the "provider" has, by ref. */
  readonly workspaces = new Map<string, FakeState>();
  /** Every call, in order, e.g. `create 1f…` or `pause fake-1f…`. */
  readonly calls: string[] = [];
  /** Requests the agent received, and what it answers next (a hello by default). */
  readonly agentRequests: { ref: string; request: AgentRequest }[] = [];
  agentAnswer: AgentResponse = { ok: true, result: { protocol: 1, node: 'v24' } };
  /** The workspace's side of each terminal opened, newest last. */
  readonly terminals: { ref: string; size: { cols: number; rows: number }; socket: FakeSocket }[] =
    [];
  /** What the "machine" is short of; the resource guard's answer (step 8a). Not recorded in `calls`. */
  pressureNow: PressureKind[] = [];
  private readonly failures = new Map<Method, Error>();
  private readonly holds = new Map<Method, Promise<void>>();

  /** The next call of `method` throws `error` instead of acting. */
  failNext(method: Method, error: Error): void {
    this.failures.set(method, error);
  }

  /** The next call of `method` waits until the returned function is called, to test races. */
  holdNext(method: Method): () => void {
    let release: (() => void) | undefined;
    this.holds.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      release?.();
    };
  }

  pressure(): Promise<readonly PressureKind[]> {
    return Promise.resolve(this.pressureNow);
  }

  /** The provider forgets a workspace, as if it was removed by hand or lost in a restart. */
  lose(ref: string): void {
    this.workspaces.delete(ref);
  }

  private async enter(method: Method, subject: string): Promise<void> {
    this.calls.push(`${method} ${subject}`);
    const hold = this.holds.get(method);
    this.holds.delete(method);
    if (hold !== undefined) await hold;
    const failure = this.failures.get(method);
    this.failures.delete(method);
    if (failure !== undefined) throw failure;
  }

  private known(ref: string): FakeState {
    const state = this.workspaces.get(ref);
    if (state === undefined) throw new ProviderError('gone', 'That workspace no longer exists.');
    return state;
  }

  /** Every create's input, in order. */
  readonly created: { workspaceId: string; repoUrl: string | null; commit?: string | null }[] = [];

  async create(input: { workspaceId: string; repoUrl: string | null; commit?: string | null }) {
    this.created.push(input);
    await this.enter('create', input.workspaceId);
    const ref = `fake-${input.workspaceId}`;
    this.workspaces.set(ref, 'running');
    return { ref };
  }

  async start(ref: string) {
    await this.enter('start', ref);
    this.known(ref);
    this.workspaces.set(ref, 'running');
  }

  async pause(ref: string) {
    await this.enter('pause', ref);
    this.known(ref);
    this.workspaces.set(ref, 'paused');
  }

  async resume(ref: string) {
    await this.enter('resume', ref);
    if (this.known(ref) === 'stopped') throw new ProviderError('gone', 'That workspace stopped.');
    this.workspaces.set(ref, 'running');
  }

  async stop(ref: string) {
    await this.enter('stop', ref);
    this.known(ref);
    this.workspaces.set(ref, 'stopped');
  }

  async agent(ref: string, request: AgentRequest): Promise<AgentResponse> {
    await this.enter('agent', ref);
    if (this.known(ref) !== 'running') throw new ProviderError('refused', 'Resume it first.');
    this.agentRequests.push({ ref, request });
    return this.agentAnswer;
  }

  async terminal(ref: string, size: { cols: number; rows: number }): Promise<TerminalSocket> {
    await this.enter('terminal', ref);
    if (this.known(ref) !== 'running') throw new ProviderError('refused', 'Resume it first.');
    const socket = new FakeSocket();
    this.terminals.push({ ref, size, socket });
    return socket;
  }
}

/** A WebSocket for tests: records what's sent, and lets the test deliver messages and closes. */
export class FakeSocket implements TerminalSocket {
  binaryType = 'blob';
  accepted = false;
  closed: { code: number | undefined; reason: string | undefined } | undefined;
  readonly sent: (string | ArrayBuffer)[] = [];
  readonly #listeners = new Map<string, ((event: { data: unknown }) => void)[]>();

  accept(): void {
    this.accepted = true;
  }

  send(data: string | ArrayBuffer): void {
    if (this.closed !== undefined) throw new Error('send after close');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.closed !== undefined) return;
    this.closed = { code, reason };
    this.emit('close');
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  /** Delivers an event as the other end would. */
  emit(type: 'message' | 'close' | 'error', data?: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener({ data });
  }
}
