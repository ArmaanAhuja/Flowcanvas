// Workspaces as Docker containers (ADR 0016). Every name is derived from the workspace ID and a prefix, and
// every docker command is built by workspace-image's spec.ts or from those names; nothing comes from a request.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LABEL,
  egressNetworkCreateArgs,
  egressRunArgs,
  networkCreateArgs,
  runArgs,
} from '@flowcanvas/workspace-image';
import type { AgentRequest, AgentResponse } from '@flowcanvas/workspace-agent/protocol';
import { Agents, dockerAgent } from './agents.js';
import { DockerFailure, type Docker } from './docker-cli.js';
import { socketEngine, type Engine } from './engine.js';
import { openTerminal, type TerminalSession } from './terminal.js';
import { HostError } from './errors.js';
import type { CreateRequest, CreateResponse, Pressure } from './protocol.js';

/** At most this many workspaces run (not asleep) at once on this computer (owner, 4 Nov 2026). */
export const MAX_RUNNING = 2;
export const CLONE_TIMEOUT_MS = 120_000;
export const PROJECT_DIR = '/workspace/project';
/** Shells open at once in one workspace. */
export const MAX_TERMINALS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Clones come from public GitHub repositories only for now (the egress proxy also allows package registries).
const GITHUB_REPO =
  /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?(\.git)?\/?$/;

export const MESSAGES = {
  full: `${String(MAX_RUNNING)} workspaces are already running on this computer. Put one to sleep or stop it, then try again.`,
  notGitHub:
    'Only public GitHub repositories can be opened for now, with an address like https://github.com/owner/repo.',
  cloneFailed:
    "The repository couldn't be cloned. Check that it's a public GitHub repository, then try again.",
  gone: 'This workspace no longer exists on this computer.',
  asleep: 'This workspace is asleep. Resume it first.',
  notRunning: 'This workspace isn’t running. Open it first.',
  tooManyTerminals: `This workspace already has ${String(MAX_TERMINALS)} terminals open. Close one first.`,
} as const;

const PROXY_SCRIPT = fileURLToPath(new URL('./egress/proxy.ts', import.meta.url));

type ContainerState =
  'running' | 'paused' | 'exited' | 'created' | 'restarting' | 'dead' | 'missing';

export interface WorkspaceHostOptions {
  readonly docker: Docker;
  /** Prefix of every Docker name this host creates: `fc` normally, a unique one in tests. */
  readonly prefix: string;
  /** The workspace image's tag, built if missing (workspace-image's buildImage). */
  readonly image: () => Promise<string>;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  readonly limits?: Parameters<typeof runArgs>[0]['limits'];
  /** The agent connections; by default, the agent copied in and started with docker exec. */
  readonly agents?: Agents;
  /** The Docker Engine API, for terminals (ADR 0017); by default, Docker's own socket. */
  readonly engine?: Engine;
  /** What the resource guard last found (guard.ts); none by default. */
  readonly pressure?: () => readonly Pressure[];
}

export class WorkspaceHost {
  readonly #options: WorkspaceHostOptions;
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #agents: Agents;
  readonly #engine: Engine;
  readonly #terminals = new Map<string, number>();

  constructor(options: WorkspaceHostOptions) {
    this.#options = options;
    this.#agents = options.agents ?? new Agents(dockerAgent(options.docker));
    this.#engine = options.engine ?? socketEngine();
  }

  get #prefix() {
    return this.#options.prefix;
  }

  get #egress() {
    return { name: `${this.#prefix}-egress`, network: `${this.#prefix}-egress-out` };
  }

  /** The container, network and volume of one workspace all share this name. */
  refFor(workspaceId: string): string {
    return `${this.#prefix}-ws-${workspaceId}`;
  }

  /** Whether `ref` is one of this host's workspaces (checked before it reaches any docker command). */
  isRef(ref: string): boolean {
    const start = `${this.#prefix}-ws-`;
    return ref.startsWith(start) && UUID.test(ref.slice(start.length));
  }

  async create(request: CreateRequest): Promise<CreateResponse> {
    if (!UUID.test(request.workspaceId)) throw new HostError('failed', 'Invalid workspace ID.');
    if (request.repoUrl !== null && !GITHUB_REPO.test(request.repoUrl)) {
      throw new HostError('failed', MESSAGES.notGitHub);
    }
    const ref = this.refFor(request.workspaceId);
    return this.#locked(ref, async () => {
      const state = await this.#state(ref);
      if (state !== 'running') await this.#checkRoom(ref, state === 'paused' ? 'resume' : 'start');
      const image = await this.#options.image();
      await this.#ready(ref, image);
      if (state === 'missing') {
        await this.#docker(
          runArgs({
            name: ref,
            prefix: this.#prefix,
            workspaceId: request.workspaceId,
            network: ref,
            volume: ref,
            egress: this.#egress.name,
            image,
            ...(this.#options.limits === undefined ? {} : { limits: this.#options.limits }),
          }),
        );
      } else {
        await this.#wake(ref, state);
      }
      return this.#clone(ref, request.repoUrl);
    });
  }

  async start(ref: string): Promise<void> {
    await this.#locked(ref, async () => {
      const state = await this.#known(ref);
      if (state === 'running') return;
      await this.#checkRoom(ref, state === 'paused' ? 'resume' : 'start');
      await this.#ready(ref, await this.#options.image());
      await this.#wake(ref, state);
    });
  }

  async pause(ref: string): Promise<void> {
    await this.#locked(ref, async () => {
      const state = await this.#known(ref);
      if (state === 'paused') return;
      // A stopped container can't be put to sleep: as far as the control plane goes, it's gone.
      if (state !== 'running') throw new HostError('gone', MESSAGES.gone);
      await this.#docker(['pause', ref]);
    });
  }

  async resume(ref: string): Promise<void> {
    await this.#locked(ref, async () => {
      const state = await this.#known(ref);
      if (state === 'running') return;
      // Lost while asleep (the computer restarted, or Docker did).
      if (state !== 'paused') throw new HostError('gone', MESSAGES.gone);
      await this.#checkRoom(ref, 'resume');
      await this.#ready(ref, await this.#options.image());
      await this.#docker(['unpause', ref]);
    });
  }

  /** A file or process request for the agent in a running workspace. Not locked: requests run side by side. */
  async agent(ref: string, request: AgentRequest): Promise<AgentResponse> {
    const state = await this.#known(ref);
    if (state === 'paused') throw new HostError('refused', MESSAGES.asleep);
    if (state !== 'running') throw new HostError('refused', MESSAGES.notRunning);
    return this.#agents.call(ref, request);
  }

  /** A shell on a pty in a running workspace, in the project folder when there is one (ADR 0017). */
  async terminal(ref: string, size: { cols: number; rows: number }): Promise<TerminalSession> {
    const state = await this.#known(ref);
    if (state === 'paused') throw new HostError('refused', MESSAGES.asleep);
    if (state !== 'running') throw new HostError('refused', MESSAGES.notRunning);
    const open = this.#terminals.get(ref) ?? 0;
    if (open >= MAX_TERMINALS) throw new HostError('refused', MESSAGES.tooManyTerminals);
    this.#terminals.set(ref, open + 1);
    try {
      const hasProject = await this.#docker(['exec', ref, 'test', '-d', PROJECT_DIR]).then(
        () => true,
        () => false,
      );
      const session = await openTerminal(this.#engine, ref, {
        ...size,
        cwd: hasProject ? PROJECT_DIR : '/workspace',
      });
      session.stream.once('close', () => {
        this.#release(ref);
      });
      return session;
    } catch (error) {
      this.#release(ref);
      throw error;
    }
  }

  #release(ref: string): void {
    const open = (this.#terminals.get(ref) ?? 1) - 1;
    if (open <= 0) this.#terminals.delete(ref);
    else this.#terminals.set(ref, open);
  }

  async stop(ref: string): Promise<void> {
    await this.#locked(ref, async () => {
      this.#agents.close(ref);
      const state = await this.#known(ref);
      if (state === 'paused') await this.#docker(['unpause', ref]);
      if (state === 'running' || state === 'paused' || state === 'restarting') {
        await this.#docker(['stop', '--time', '10', ref], { timeoutMs: 30_000 });
      }
    });
  }

  /** One operation at a time per workspace, so a pause can't interleave with a start. */
  async #locked<T>(ref: string, action: () => Promise<T>): Promise<T> {
    const before = this.#locks.get(ref) ?? Promise.resolve();
    const run = before.then(action, action);
    const settled = run.catch(() => undefined);
    this.#locks.set(ref, settled);
    try {
      return await run;
    } finally {
      if (this.#locks.get(ref) === settled) this.#locks.delete(ref);
    }
  }

  async #docker(args: readonly string[], options?: { timeoutMs?: number }): Promise<string> {
    return (await this.#options.docker(args, options)).stdout;
  }

  async #state(ref: string): Promise<ContainerState> {
    try {
      return (await this.#docker([
        'inspect',
        '--type',
        'container',
        '--format',
        '{{.State.Status}}',
        ref,
      ])) as ContainerState;
    } catch (error) {
      if (error instanceof DockerFailure && error.missing) return 'missing';
      throw error;
    }
  }

  async #known(ref: string): Promise<Exclude<ContainerState, 'missing'>> {
    if (!this.isRef(ref)) throw new HostError('gone', MESSAGES.gone);
    const state = await this.#state(ref);
    if (state === 'missing') throw new HostError('gone', MESSAGES.gone);
    return state;
  }

  /** What the resource guard last found; empty when the computer has room. */
  pressure(): readonly Pressure[] {
    return this.#options.pressure?.() ?? [];
  }

  /**
   * Refuses to start another workspace when MAX_RUNNING already run (asleep ones don't count), or when the
   * resource guard reports pressure. Resuming holds no new memory or disk (a paused workspace keeps both), so
   * only a busy computer refuses it.
   */
  async #checkRoom(ref: string, waking: 'start' | 'resume'): Promise<void> {
    const blocking = this.pressure().find((p) => waking === 'start' || p.kind === 'load');
    if (blocking !== undefined) throw new HostError('refused', blocking.message);
    const running = (
      await this.#docker([
        'ps',
        '--filter',
        `label=${LABEL.prefix}=${this.#prefix}`,
        '--filter',
        `label=${LABEL.role}=workspace`,
        '--filter',
        'status=running',
        '--format',
        '{{.Names}}',
      ])
    )
      .split('\n')
      .filter((name) => name !== '' && name !== ref);
    if (running.length >= MAX_RUNNING) throw new HostError('refused', MESSAGES.full);
  }

  async #wake(ref: string, state: ContainerState): Promise<void> {
    if (state === 'paused') await this.#docker(['unpause', ref]);
    else if (state !== 'running') await this.#docker(['start', ref]);
  }

  /** Everything a workspace needs around it: the egress proxy, its network (connected to it), its volume. */
  async #ready(ref: string, image: string): Promise<void> {
    await this.#ensureEgress(image);
    if (!(await this.#exists('network', ref))) {
      await this.#docker(networkCreateArgs(ref, this.#prefix));
    }
    if (!(await this.#exists('volume', ref))) {
      await this.#docker([
        'volume',
        'create',
        '--label',
        `${LABEL.ours}=1`,
        '--label',
        `${LABEL.prefix}=${this.#prefix}`,
        '--label',
        `${LABEL.role}=workspace`,
        ref,
      ]);
    }
    try {
      await this.#docker(['network', 'connect', ref, this.#egress.name]);
    } catch (error) {
      if (!(error instanceof DockerFailure && /already exists/i.test(error.stderr))) throw error;
    }
  }

  async #exists(type: 'network' | 'volume' | 'container', name: string): Promise<boolean> {
    try {
      await this.#docker([type, 'inspect', '--format', '{{.Name}}', name]);
      return true;
    } catch (error) {
      if (error instanceof DockerFailure && error.missing) return false;
      throw error;
    }
  }

  /** Starts the egress proxy if needed, and replaces it when its script or image changed. */
  async #ensureEgress(image: string): Promise<void> {
    const { name, network } = this.#egress;
    const version = createHash('sha256')
      .update(readFileSync(PROXY_SCRIPT))
      .update(image)
      .digest('hex')
      .slice(0, 12);
    if (!(await this.#exists('network', network))) {
      await this.#docker(egressNetworkCreateArgs(network, this.#prefix));
    }
    let current: string | undefined;
    try {
      current = await this.#docker([
        'inspect',
        '--type',
        'container',
        '--format',
        '{{index .Config.Labels "org.flowcanvas.egress-version"}} {{.State.Status}}',
        name,
      ]);
    } catch (error) {
      if (!(error instanceof DockerFailure && error.missing)) throw error;
    }
    if (current === `${version} running`) return;
    if (current?.startsWith(`${version} `) === true) {
      await this.#docker(['start', name]);
      return;
    }
    if (current !== undefined) {
      this.#options.log('egress proxy changed; replacing it');
      await this.#docker(['rm', '--force', name]);
    }
    await this.#docker(
      egressRunArgs({ name, prefix: this.#prefix, network, image, script: PROXY_SCRIPT, version }),
    );
    // A new proxy isn't attached to any workspace network yet: attach the ones that exist.
    const networks = await this.#docker([
      'network',
      'ls',
      '--filter',
      `label=${LABEL.prefix}=${this.#prefix}`,
      '--filter',
      `label=${LABEL.role}=workspace`,
      '--format',
      '{{.Name}}',
    ]);
    for (const workspaceNetwork of networks.split('\n').filter((line) => line !== '')) {
      await this.#docker(['network', 'connect', workspaceNetwork, name]).catch(() => undefined);
    }
  }

  /** Clones the repository on first open; a workspace that already has it keeps its files as they are. */
  async #clone(ref: string, repoUrl: string | null): Promise<CreateResponse> {
    if (repoUrl === null) return { ref, cloned: false, cloneMs: null };
    try {
      await this.#docker(['exec', ref, 'test', '-d', `${PROJECT_DIR}/.git`]);
      return { ref, cloned: false, cloneMs: null };
    } catch (error) {
      if (!(error instanceof DockerFailure)) throw error;
    }
    const now = this.#options.now ?? Date.now;
    const started = now();
    try {
      await this.#docker(
        [
          'exec',
          ref,
          'git',
          // https only, including for submodules; no local file or ssh transports.
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.https.allow=always',
          'clone',
          '--depth',
          '1',
          '--single-branch',
          '--no-tags',
          '--',
          repoUrl,
          PROJECT_DIR,
        ],
        { timeoutMs: CLONE_TIMEOUT_MS },
      );
    } catch (error) {
      // Only the exit code: git's output could include the address and the proxy's answers.
      this.#options.log(
        `clone failed for ${ref}: exit ${error instanceof DockerFailure ? String(error.exitCode) : 'unknown'}`,
      );
      await this.#docker(['exec', ref, 'rm', '-rf', PROJECT_DIR]).catch(() => undefined);
      throw new HostError('failed', MESSAGES.cloneFailed);
    }
    const cloneMs = now() - started;
    this.#options.log(`cloned into ${ref} in ${String(cloneMs)} ms`);
    return { ref, cloned: true, cloneMs };
  }
}
