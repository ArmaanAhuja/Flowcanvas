// An in-memory WorkspaceProvider for lifecycle and route tests: no Docker, no network.
import { ProviderError, type WorkspaceProvider } from '../workspaces/provider.js';

type Method = 'create' | 'start' | 'pause' | 'resume' | 'stop';
type FakeState = 'running' | 'paused' | 'stopped';

export class FakeProvider implements WorkspaceProvider {
  readonly name = 'fake';
  /** What the "provider" has, by ref. */
  readonly workspaces = new Map<string, FakeState>();
  /** Every call, in order, e.g. `create 1f…` or `pause fake-1f…`. */
  readonly calls: string[] = [];
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

  async create(input: { workspaceId: string; repoUrl: string | null }) {
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
}
