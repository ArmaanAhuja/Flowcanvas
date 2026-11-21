// The project's processes (build plan v2, phase 3): its scripts, installing its dependencies and starting its
// services, each started by the person and shown as a card with its output. Each runs on a pty, as it would in their
// terminal: colours, progress bars, and prompts they can answer (a dev script that asks for sudo, or "use another
// port?"). Each is the leader of its own process group, so stopping it stops everything it started, and closing the
// app stops them all: nothing keeps running that the person didn't start.
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, isAbsolute, join } from 'node:path';

export type ProcessKind = 'script' | 'install' | 'services';
export type ProcessState = 'running' | 'stopping' | 'stopped' | 'finished' | 'failed';

export interface ProcessView {
  readonly id: string;
  readonly kind: ProcessKind;
  /** `dev`, `Install dependencies`, `Start services`. */
  readonly label: string;
  /** What runs, as a person would type it (`pnpm run dev`). */
  readonly command: string;
  readonly state: ProcessState;
  /** Set once it has ended by itself. */
  readonly exitCode: number | null;
  /** Ports its output says it listens on (`http://localhost:3000`), first seen first. */
  readonly ports: readonly number[];
  /** Why it couldn't start, in words (`pnpm isn’t installed…`). */
  readonly problem: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export type ProcessEvent =
  | { readonly type: 'process'; readonly process: ProcessView }
  /** Terminal output (colour codes and all), already masked. */
  | { readonly type: 'output'; readonly id: string; readonly text: string };

export interface StartOptions {
  readonly kind: ProcessKind;
  readonly label: string;
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Hides secret values in what it prints (the project's .env values), before anything keeps or shows it. */
  readonly mask?: (text: string) => string;
}

/** What the manager needs from a pty (node-pty's IPty, narrowed so tests could pass their own). */
export interface ProcessPty {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (exit: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

export type SpawnPty = (
  file: string,
  args: readonly string[],
  options: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
) => ProcessPty;

export const PROCESS_LIMITS = {
  /** Output kept per process, from the end (older output is dropped). */
  logChars: 256 * 1024,
  /** How long a process has to stop after SIGTERM before it's killed. */
  stopMs: 5000,
  /** Ended processes kept as cards (the oldest are dropped). */
  ended: 20,
  /** An unfinished line (a prompt) is shown after this long without more output. */
  partialMs: 40,
  /** Largest typing or pasting sent to a process at once. */
  inputChars: 64 * 1024,
  cols: 120,
  rows: 30,
} as const;

// Plain addresses a server prints when it's ready: `localhost:3000`, `127.0.0.1:5173`, `0.0.0.0:8080`, `[::]:3000`.
const ADDRESS = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/g;
// Colour and cursor codes, taken out before looking for addresses.
// eslint-disable-next-line no-control-regex -- matching the escape character is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Variables of ours that the project's processes mustn't inherit. */
const OURS = /^(ELECTRON_|FLOWCANVAS_|CHROME_|GOOGLE_API_KEY$|ORIGINAL_XDG_)/;

export function childEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !OURS.test(name)));
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function portsIn(text: string): number[] {
  const ports: number[] = [];
  for (const match of stripAnsi(text).matchAll(ADDRESS)) {
    const port = Number(match[1]);
    if (port > 0 && port < 65536 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

/** Finds a program on the PATH, as the shell would. */
export function onPath(program: string, path = process.env.PATH ?? ''): boolean {
  const executable = (file: string) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(program)) return executable(program);
  return path.split(delimiter).some((folder) => folder !== '' && executable(join(folder, program)));
}

/** node-pty, loaded on first use (it's a native module). */
export function loadNodePty(): typeof import('node-pty') {
  return createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
}

export const nodePtySpawn: SpawnPty = (file, args, { cwd, cols, rows, env }) =>
  loadNodePty().spawn(file, [...args], {
    name: 'xterm-256color',
    cwd,
    cols,
    rows,
    env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

interface Entry {
  view: ProcessView;
  readonly options: StartOptions;
  pty: ProcessPty | undefined;
  log: string;
  /** The last unfinished line, held a moment so a secret split across two chunks is still whole when masked. */
  partial: string;
  partialTimer: NodeJS.Timeout | undefined;
  killTimer: NodeJS.Timeout | undefined;
}

export class Processes {
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<(event: ProcessEvent) => void>();
  readonly #now: () => Date;
  readonly #spawn: SpawnPty;
  readonly #onPath: (program: string) => boolean;
  #next = 0;

  constructor(
    options: {
      readonly now?: () => Date;
      readonly spawn?: SpawnPty;
      readonly onPath?: (program: string) => boolean;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#spawn = options.spawn ?? nodePtySpawn;
    this.#onPath = options.onPath ?? ((program) => onPath(program, childEnvironment().PATH));
  }

  list(): ProcessView[] {
    return [...this.#entries.values()].map((entry) => entry.view);
  }

  get(id: string): ProcessView | undefined {
    return this.#entries.get(id)?.view;
  }

  /** Its output so far (masked, colour codes kept), for a card opened after it started. */
  log(id: string): string | undefined {
    return this.#entries.get(id)?.log;
  }

  onEvent(listener: (event: ProcessEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** A running process with the same label is returned as it is, rather than started twice. */
  start(options: StartOptions): ProcessView {
    const running = [...this.#entries.values()].find(
      (entry) => entry.view.label === options.label && isLive(entry.view.state),
    );
    if (running !== undefined) return running.view;
    this.#next += 1;
    const entry: Entry = {
      view: {
        id: `p${String(this.#next)}`,
        kind: options.kind,
        label: options.label,
        command: [options.file, ...options.args].join(' '),
        state: 'running',
        exitCode: null,
        ports: [],
        problem: null,
        startedAt: this.#now().toISOString(),
        endedAt: null,
      },
      options,
      pty: undefined,
      log: '',
      partial: '',
      partialTimer: undefined,
      killTimer: undefined,
    };
    this.#entries.set(entry.view.id, entry);
    this.#prune();
    this.#start(entry);
    return entry.view;
  }

  /** Typing into it (answering a prompt). Nothing typed is kept or logged. */
  input(id: string, data: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.pty === undefined || entry.view.state !== 'running') return false;
    if (data.length > PROCESS_LIMITS.inputChars) return false;
    entry.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.#entries.get(id);
    if (entry?.pty === undefined || entry.view.state !== 'running') return;
    try {
      entry.pty.resize(cols, rows);
    } catch {
      // It ended in the meantime.
    }
  }

  /** Stops it and everything it started: SIGTERM to its group, then SIGKILL if it's still there. */
  stop(id: string): ProcessView | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined || !isLive(entry.view.state)) return entry?.view;
    this.#update(entry, { state: 'stopping' });
    this.#signal(entry, 'SIGTERM');
    entry.killTimer = setTimeout(() => {
      this.#signal(entry, 'SIGKILL');
    }, PROCESS_LIMITS.stopMs);
    return entry.view;
  }

  /** Stops it if it's running, then starts it again as a new card. */
  async restart(id: string): Promise<ProcessView | undefined> {
    const entry = this.#entries.get(id);
    if (entry === undefined) return undefined;
    if (isLive(entry.view.state)) {
      this.stop(id);
      await this.#ended(entry);
    }
    return this.start(entry.options);
  }

  /** Every process stopped (the app is closing). */
  async stopAll(): Promise<void> {
    const live = [...this.#entries.values()].filter((entry) => isLive(entry.view.state));
    for (const entry of live) this.stop(entry.view.id);
    await Promise.all(live.map((entry) => this.#ended(entry)));
  }

  #start(entry: Entry): void {
    const { file, args, cwd } = entry.options;
    // node-pty can't say a program is missing (the exec fails in the child), so it's looked for first.
    if (!this.#onPath(file)) {
      this.#failed(
        entry,
        `${file} isn’t installed, or Flowcanvas can’t find it on your PATH. Install it, then try again.`,
      );
      return;
    }
    let pty: ProcessPty;
    try {
      pty = this.#spawn(file, args, {
        cwd,
        cols: PROCESS_LIMITS.cols,
        rows: PROCESS_LIMITS.rows,
        env: childEnvironment(),
      });
    } catch (error) {
      this.#failed(
        entry,
        `${file} couldn’t start (${error instanceof Error ? error.message : 'unknown error'}).`,
      );
      return;
    }
    entry.pty = pty;
    pty.onData((data) => {
      this.#output(entry, data);
    });
    pty.onExit(({ exitCode, signal }) => {
      clearTimeout(entry.killTimer);
      clearTimeout(entry.partialTimer);
      this.#flush(entry);
      const stopped = entry.view.state === 'stopping' || (signal !== undefined && signal !== 0);
      this.#update(entry, {
        state: stopped ? 'stopped' : exitCode === 0 ? 'finished' : 'failed',
        exitCode: stopped ? null : exitCode,
        endedAt: this.#now().toISOString(),
      });
    });
  }

  #output(entry: Entry, raw: string): void {
    const text = entry.partial + raw;
    const end = text.lastIndexOf('\n') + 1;
    entry.partial = text.slice(end);
    clearTimeout(entry.partialTimer);
    if (end > 0) this.#emitOutput(entry, text.slice(0, end));
    // A prompt doesn't end its line: shown once the output pauses.
    if (entry.partial !== '') {
      entry.partialTimer = setTimeout(() => {
        this.#flush(entry);
      }, PROCESS_LIMITS.partialMs);
    }
  }

  #flush(entry: Entry): void {
    if (entry.partial === '') return;
    const text = entry.partial;
    entry.partial = '';
    this.#emitOutput(entry, text);
  }

  #emitOutput(entry: Entry, raw: string): void {
    const text = (entry.options.mask ?? ((value: string) => value))(raw);
    entry.log = (entry.log + text).slice(-PROCESS_LIMITS.logChars);
    this.#emit({ type: 'output', id: entry.view.id, text });
    const found = portsIn(text).filter((port) => !entry.view.ports.includes(port));
    if (found.length > 0) this.#update(entry, { ports: [...entry.view.ports, ...found] });
  }

  #failed(entry: Entry, problem: string): void {
    this.#update(entry, { state: 'failed', problem, endedAt: this.#now().toISOString() });
  }

  #signal(entry: Entry, signal: NodeJS.Signals): void {
    const pid = entry.pty?.pid;
    if (pid === undefined) return;
    try {
      // The pty's child leads its own session and group; the minus sign sends to the whole group.
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  }

  #ended(entry: Entry): Promise<void> {
    if (!isLive(entry.view.state)) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.onEvent((event) => {
        if (
          event.type === 'process' &&
          event.process.id === entry.view.id &&
          !isLive(event.process.state)
        ) {
          off();
          resolve();
        }
      });
    });
  }

  #update(entry: Entry, change: Partial<ProcessView>): void {
    entry.view = { ...entry.view, ...change };
    this.#emit({ type: 'process', process: entry.view });
  }

  #emit(event: ProcessEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #prune(): void {
    const ended = [...this.#entries.values()].filter((entry) => !isLive(entry.view.state));
    for (const entry of ended.slice(0, Math.max(0, ended.length - PROCESS_LIMITS.ended))) {
      this.#entries.delete(entry.view.id);
    }
  }
}

function isLive(state: ProcessState): boolean {
  return state === 'running' || state === 'stopping';
}
