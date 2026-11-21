// Running each open project (build plan v2, phase 3): its run plan, its processes, and setting a missing variable.
// Only what the plan offers can be started (its own scripts, installing, its compose file), and a value can only go
// into a .env file beside one of its examples.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detectRunPlan, EXAMPLES, SET_IN, type RunPlan } from './detect.js';
import { createEnvFile, EnvProblem, parseEnvEntries, setEnvValue } from './env.js';
import {
  childEnvironment,
  onPath,
  Processes,
  type ProcessEvent,
  type ProcessView,
  type SpawnPty,
} from './processes.js';

export type StartRequest =
  | { readonly kind: 'script'; readonly script: string }
  | { readonly kind: 'install' }
  | { readonly kind: 'services' }
  /** Stops the containers "Start services" started (they'd otherwise keep running in Docker). */
  | { readonly kind: 'services-stop' };

export interface RunState {
  readonly plan: RunPlan;
  /** Docker is on the PATH (needed for "Start services"). */
  readonly docker: boolean;
  readonly processes: readonly ProcessView[];
}

export class RunProblem extends Error {
  override readonly name = 'RunProblem';
}

export const RUN_MESSAGES = {
  noScript: 'That script isn’t in the project’s package.json.',
  noCompose: 'The project has no compose file for its services.',
  noDocker:
    'Docker isn’t installed, or Flowcanvas can’t find it on your PATH. Install Docker to start the project’s services.',
  notAnEnvFile: 'Values can only go into a .env file beside one of the project’s examples.',
  noProcess: 'No such process.',
  envExists: 'That .env file is there already.',
} as const;

/** Secret values shorter than this aren't masked (`true`, `3000` would hide half a log). */
const MASK_MIN = 6;
export const MASK = '••••••';

export interface RunServiceOptions {
  /** The project's file list (git's, without secret files), as the file tree has it. */
  readonly files: (root: string) => Promise<readonly string[]>;
  /** Whether Docker is there (for tests; looked for on the PATH otherwise). */
  readonly onPath?: (program: string) => boolean;
  /** For tests: how processes are started (node-pty otherwise). */
  readonly spawn?: SpawnPty;
  /** `node --version` on the person's PATH, or null; asked once per state. */
  readonly nodeVersion?: () => string | null;
}

/** `node --version` from the PATH the project's processes get (not Electron's own Node). */
export function nodeOnPath(): string | null {
  try {
    return execFileSync('node', ['--version'], {
      env: childEnvironment(),
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export class RunService {
  readonly #options: RunServiceOptions;
  readonly #processes = new Map<string, Processes>();
  readonly #listeners = new Set<(root: string, event: ProcessEvent) => void>();

  constructor(options: RunServiceOptions) {
    this.#options = options;
  }

  processes(root: string): Processes {
    const known = this.#processes.get(root);
    if (known !== undefined) return known;
    const processes = new Processes({
      ...(this.#options.spawn === undefined ? {} : { spawn: this.#options.spawn }),
    });
    processes.onEvent((event) => {
      for (const listener of this.#listeners) listener(root, event);
    });
    this.#processes.set(root, processes);
    return processes;
  }

  onEvent(listener: (root: string, event: ProcessEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async state(root: string): Promise<RunState> {
    return {
      plan: detectRunPlan(
        root,
        await this.#options.files(root),
        childEnvironment(),
        (this.#options.nodeVersion ?? nodeOnPath)(),
      ),
      docker: (this.#options.onPath ?? ((program) => onPath(program, childEnvironment().PATH)))(
        'docker',
      ),
      processes: this.processes(root).list(),
    };
  }

  async start(root: string, request: StartRequest): Promise<ProcessView> {
    const { plan, docker } = await this.state(root);
    const pm = plan.packageManager;
    const base = { cwd: root, mask: this.#masker(root, await this.#options.files(root)) };
    if (request.kind === 'script') {
      if (!plan.scripts.some((script) => script.name === request.script))
        throw new RunProblem(RUN_MESSAGES.noScript);
      return this.processes(root).start({
        ...base,
        kind: 'script',
        label: request.script,
        file: pm,
        args: ['run', request.script],
      });
    }
    if (request.kind === 'install') {
      return this.processes(root).start({
        ...base,
        kind: 'install',
        label: 'Install dependencies',
        file: pm,
        args: ['install'],
      });
    }
    if (plan.compose === null) throw new RunProblem(RUN_MESSAGES.noCompose);
    if (!docker) throw new RunProblem(RUN_MESSAGES.noDocker);
    const stopping = request.kind === 'services-stop';
    return this.processes(root).start({
      ...base,
      kind: 'services',
      label: stopping ? 'Stop services' : 'Start services',
      file: 'docker',
      args: ['compose', '-f', plan.compose, ...(stopping ? ['stop'] : ['up', '-d'])],
    });
  }

  stop(root: string, id: string): ProcessView {
    const view = this.processes(root).stop(id);
    if (view === undefined) throw new RunProblem(RUN_MESSAGES.noProcess);
    return view;
  }

  async restart(root: string, id: string): Promise<ProcessView> {
    const view = await this.processes(root).restart(id);
    if (view === undefined) throw new RunProblem(RUN_MESSAGES.noProcess);
    return view;
  }

  input(root: string, id: string, data: string): boolean {
    return this.processes(root).input(id, data);
  }

  resize(root: string, id: string, cols: number, rows: number): void {
    this.processes(root).resize(id, cols, rows);
  }

  log(root: string, id: string): string {
    const log = this.processes(root).log(id);
    if (log === undefined) throw new RunProblem(RUN_MESSAGES.noProcess);
    return log;
  }

  /** Sets a variable in `file` (from the root), which must be the .env beside one of the project's examples. */
  async setVariable(root: string, file: string, name: string, value: string): Promise<void> {
    const targets = envTargets(await this.#options.files(root));
    if (!targets.includes(file)) throw new RunProblem(RUN_MESSAGES.notAnEnvFile);
    try {
      setEnvValue(join(root, file), name, value);
    } catch (error) {
      if (error instanceof EnvProblem) throw new RunProblem(error.message);
      throw error;
    }
  }

  /** Creates `file` (from the root) from the example beside it, if it doesn't exist yet. */
  async createEnvFile(root: string, file: string): Promise<void> {
    const example = (await this.#options.files(root)).find(
      (path) =>
        EXAMPLES.test(path) && `${dirname(path) === '.' ? '' : `${dirname(path)}/`}.env` === file,
    );
    if (example === undefined) throw new RunProblem(RUN_MESSAGES.notAnEnvFile);
    if (existsSync(join(root, file))) throw new RunProblem(RUN_MESSAGES.envExists);
    createEnvFile(join(root, example), join(root, file));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#processes.values()].map((processes) => processes.stopAll()));
  }

  /** Hides the project's own .env values wherever a process prints them. */
  #masker(root: string, files: readonly string[]): (text: string) => string {
    const values = new Set<string>();
    for (const folder of envFolders(files)) {
      for (const name of SET_IN) {
        const file = join(root, folder, name);
        if (!existsSync(file)) continue;
        for (const [, value] of parseEnvEntries(readFileSync(file, 'utf8'))) {
          if (value.length >= MASK_MIN) values.add(value);
        }
      }
    }
    // Longest first, so a value that contains another is masked whole.
    const sorted = [...values].sort((a, b) => b.length - a.length);
    return (text) => sorted.reduce((masked, value) => masked.split(value).join(MASK), text);
  }
}

/** The folders (from the root, '' for the root) that have an example .env file, and the root itself. */
function envFolders(files: readonly string[]): string[] {
  const folders = new Set<string>(['']);
  for (const file of files) {
    if (EXAMPLES.test(file)) folders.add(dirname(file) === '.' ? '' : `${dirname(file)}/`);
  }
  return [...folders];
}

/** The file list from the file agent's `files` answer. */
export function listedFiles(result: unknown): string[] {
  const files = (result as { files?: unknown } | undefined)?.files;
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === 'string')
    : [];
}

/** The .env files a value may go into: beside an example. */
export function envTargets(files: readonly string[]): string[] {
  const targets: string[] = [];
  for (const file of files) {
    if (!EXAMPLES.test(file)) continue;
    const target = `${dirname(file) === '.' ? '' : `${dirname(file)}/`}.env`;
    if (!targets.includes(target)) targets.push(target);
  }
  return targets;
}
