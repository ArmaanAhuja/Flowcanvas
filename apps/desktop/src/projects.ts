// The folders opened in the desktop app (build plan v2, phase 1): each gets a stable id the first time, and its own
// data folder (index, graph, journal) inside the app's data, never inside the project.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export interface OpenedProject {
  readonly id: string;
  /** Absolute path of the folder. */
  readonly path: string;
  /** The folder's name, as the start screen and the top bar show it. */
  readonly name: string;
  /** ISO 8601, UTC: when it was first opened. */
  readonly openedAt: string;
  /** ISO 8601, UTC: when it was last opened (recent projects are listed newest first). */
  readonly lastOpenedAt: string;
}

/** How many recent folders the start screen keeps. */
export const MOST_RECENT = 20;

export class Projects {
  readonly #file: string;
  readonly #dataRoot: string;
  readonly #now: () => Date;
  #list: OpenedProject[];

  constructor(options: { readonly dataRoot: string; readonly now?: () => Date }) {
    this.#dataRoot = resolve(options.dataRoot);
    this.#file = join(this.#dataRoot, 'projects.json');
    this.#now = options.now ?? (() => new Date());
    mkdirSync(this.#dataRoot, { recursive: true, mode: 0o700 });
    this.#list = read(this.#file);
  }

  /** Newest first. */
  list(): readonly OpenedProject[] {
    return [...this.#list].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  get(id: string): OpenedProject | undefined {
    return this.#list.find((project) => project.id === id);
  }

  /** Opens a folder: the same id as before if it was opened already, a new one otherwise. */
  open(folder: string): OpenedProject {
    const path = resolve(folder);
    const now = this.#now().toISOString();
    const known = this.#list.find((project) => project.path === path);
    const project: OpenedProject =
      known === undefined
        ? { id: randomUUID(), path, name: basename(path), openedAt: now, lastOpenedAt: now }
        : { ...known, lastOpenedAt: now };
    this.#list = [project, ...this.#list.filter((p) => p.path !== path)];
    // The oldest fall off the list; their data folders are left alone (reopening finds them again).
    this.#list = this.list().slice(0, MOST_RECENT);
    write(this.#file, this.#list);
    return project;
  }

  /** The project's own data folder (index, graph, facts, journal), created on first use. */
  dataFolder(id: string): string {
    const folder = join(this.#dataRoot, 'projects', id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    return folder;
  }
}

function read(file: string): OpenedProject[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isProject) : [];
  } catch {
    // No file yet, or a damaged one: start with no recent projects rather than failing to start.
    return [];
  }
}

/** Written whole and renamed into place, so a crash never leaves half a file. */
function write(file: string, list: readonly OpenedProject[]): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

function isProject(value: unknown): value is OpenedProject {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.path === 'string' &&
    typeof p.name === 'string' &&
    typeof p.openedAt === 'string' &&
    typeof p.lastOpenedAt === 'string'
  );
}
