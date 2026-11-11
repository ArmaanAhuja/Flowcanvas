// What the TypeScript compiler may read in a workspace (phase 5, ADR 0026 §3). Every read goes through here:
// - files inside the project, never secret files (CLAUDE.md rule 5), never through a link that leaves it;
// - TypeScript's own standard library;
// - `…/node_modules/<package>/…` for one of the project's own packages, served from that package's folder,
//   because a fresh clone has no node_modules (packages from npm stay unreadable: the owner's "project code only").
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { IGNORED_DIRECTORIES, isSecretFile } from '@flowcanvas/workspace-agent/protocol';

/** Larger files aren't read (the agent's and the indexer's limit; a generated bundle isn't worth type-checking). */
const MAX_FILE_BYTES = 1024 * 1024;

export interface ProjectHost {
  readonly root: string;
  readonly fileExists: (path: string) => boolean;
  readonly readFile: (path: string) => string | undefined;
  readonly directoryExists: (path: string) => boolean;
  readonly getDirectories: (path: string) => string[];
  /** Real paths are what the project's files are known by; a mapped package path becomes its real one. */
  readonly realpath: (path: string) => string;
  /** Maps `…/node_modules/<own package>/<rest>` to the package's folder; any other path is returned unchanged. */
  readonly mapPath: (path: string) => string;
}

export interface HostOptions {
  readonly root: string;
  /** TypeScript's lib folder (where `lib.*.d.ts` are): readable, read-only. */
  readonly libDir: string;
  /** The project's own packages: name → absolute folder. */
  readonly packages: ReadonlyMap<string, string>;
}

export function createProjectHost(options: HostOptions): ProjectHost {
  const root = options.root;
  const names = [...options.packages.keys()].sort((a, b) => b.length - a.length);

  const mapPath = (path: string): string => {
    const at = path.lastIndexOf(`${sep}node_modules${sep}`);
    if (at === -1) return path;
    const rest = path.slice(at + `${sep}node_modules${sep}`.length);
    for (const name of names) {
      if (rest === name || rest.startsWith(`${name}/`)) {
        return (options.packages.get(name) ?? '') + rest.slice(name.length);
      }
    }
    return path;
  };

  const inside = (path: string, folder: string) => {
    const r = relative(folder, path);
    return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && r !== '..');
  };

  /** Whether `path` (already mapped) may be read: inside the project and allowed, or TypeScript's lib. */
  const allowed = (path: string): boolean => {
    if (inside(path, options.libDir)) return true;
    if (!inside(path, root)) return false;
    const parts = relative(root, path).split(sep);
    if (parts.some((part) => part !== 'node_modules' && IGNORED_DIRECTORIES.includes(part)))
      return false;
    // node_modules only through the mapping above, which leaves none in the path.
    if (parts.includes('node_modules')) return false;
    if (isSecretFile(parts.at(-1) ?? '')) return false;
    // Never through a link that leads out of the project.
    try {
      const real = realpathSync(path);
      if (!inside(real, root) && !inside(real, options.libDir)) return false;
    } catch {
      // Not there: fine, the caller finds out.
    }
    return true;
  };

  const resolve = (path: string) => mapPath(path);

  return {
    root,
    mapPath,
    fileExists: (path) => {
      const p = resolve(path);
      if (!allowed(p)) return false;
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    },
    readFile: (path) => {
      const p = resolve(path);
      if (!allowed(p)) return undefined;
      try {
        if (lstatSync(p).size > MAX_FILE_BYTES) return undefined;
        return readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    directoryExists: (path) => {
      const p = resolve(path);
      if (!allowed(p)) return false;
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    getDirectories: (path) => {
      const p = resolve(path);
      if (!allowed(p)) return [];
      try {
        return readdirSync(p, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && allowed(join(p, entry.name)))
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    realpath: (path) => {
      const p = resolve(path);
      try {
        const real = realpathSync(p);
        return allowed(real) ? real : p;
      } catch {
        return p;
      }
    },
  };
}

/** The folder of a file path, for the language service hosts. */
export const folderOf = dirname;
