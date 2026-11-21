// What runs for each open folder (build plan v2, phase 1): the file agent in this process, the engine as a child
// process, and file watchers. The same pieces the Docker workspaces ran (phases 3 and 4), on the user's own folder:
// no container, nothing uploaded.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { answer, createAgent, type Agent } from '@flowcanvas/workspace-agent/agent';
import type { AgentResponse, WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { startWatcher, type Watcher } from '@flowcanvas/workspace-agent/watch';
import type { EngineRequest, EngineResponse } from '@flowcanvas/engine/protocol';
import { Indexers, type StartEngine } from '@flowcanvas/workspace-host/indexers';

export interface FolderOptions {
  /** The engine bundle's main.js (its WebAssembly, worker and TypeScript beside it). */
  readonly engineMain: string;
  /** Where each folder's data lives: index, graph, facts and the journal. */
  readonly dataFolder: (ref: string) => string;
  /** The Node that runs the engine: Electron's own (with ELECTRON_RUN_AS_NODE), or node in tests. */
  readonly node?: string;
}

/**
 * The engine on a local folder: Electron's own Node runs the bundle, told the folder and its data folder through the
 * environment. Its errors go nowhere (they could name files); the protocol carries what the page needs.
 */
export function localEngine(options: FolderOptions): StartEngine {
  return (ref) => {
    const child = spawn(options.node ?? process.execPath, [options.engineMain], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FLOWCANVAS_PROJECT_ROOT: ref,
        FLOWCANVAS_DATA_DIR: options.dataFolder(ref),
      },
    });
    return Promise.resolve({
      stdin: child.stdin,
      stdout: child.stdout,
      kill: () => child.kill(),
      onExit: (listener) => child.on('exit', listener),
    });
  };
}

/** Every open folder's agent and engine, by its path (the "ref", as the workspaces' were by container). */
export class Folders {
  readonly #options: FolderOptions;
  readonly #agents = new Map<string, Agent>();
  readonly #indexers: Indexers;
  readonly #watchers = new Set<Watcher>();
  readonly #engines = new Set<string>();

  constructor(options: FolderOptions & { readonly startEngine?: StartEngine }) {
    this.#options = options;
    this.#indexers = new Indexers(options.startEngine ?? localEngine(options));
  }

  /** A file or journal request, answered by the folder's agent (in this process). */
  agent(ref: string, request: unknown): Promise<AgentResponse> {
    let agent = this.#agents.get(ref);
    if (agent === undefined) {
      agent = createAgent({ root: ref, journal: join(this.#options.dataFolder(ref), 'journal') });
      this.#agents.set(ref, agent);
    }
    return answer(agent, request);
  }

  /** A question for the folder's engine, started on first use and again after it stops. */
  index(ref: string, request: EngineRequest): Promise<EngineResponse> {
    this.#engines.add(ref);
    return this.#indexers.call(ref, request);
  }

  /** Follows the folder's file changes until closed. */
  async watch(ref: string, emit: (event: WatchEvent) => void): Promise<Watcher> {
    const watcher = await startWatcher({ root: ref, emit });
    this.#watchers.add(watcher);
    return {
      close: () => {
        this.#watchers.delete(watcher);
        watcher.close();
      },
    };
  }

  /** Ends every engine and watcher (the app is quitting). */
  close(): void {
    for (const ref of this.#engines) this.#indexers.close(ref);
    this.#engines.clear();
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers.clear();
  }
}
