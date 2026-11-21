// What it takes to run a project (build plan v2, phase 3), read from its files: the package manager (from the
// lockfile), whether its dependencies are installed, its scripts, a development compose file for its services, and
// the environment variables its example files list that aren't set. Values are never read into anything shown,
// logged or sent: only names, and whether each is set.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnvSet, parseExample } from './env.js';
import { nodeFits } from './node-version.js';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

export interface Script {
  readonly name: string;
  /** As written in package.json: shown, never run directly (the package manager runs it). */
  readonly command: string;
}

export interface MissingVariable {
  readonly name: string;
  /** The example file that lists it, from the project's root (`apps/web/.env.sample`). */
  readonly listedIn: string;
  /** The file a value goes into: the `.env` beside it (`apps/web/.env`). */
  readonly file: string;
  /** What the example's comment says: required (true), optional (false), or nothing (null). */
  readonly required: boolean | null;
}

export interface EnvFile {
  /** The example (`apps/web/.env.sample`). */
  readonly example: string;
  /** The .env beside it (`apps/web/.env`). */
  readonly file: string;
  readonly exists: boolean;
}

export interface NodeCheck {
  /** The project's `engines.node` (`24`, `>=20.9.0`). */
  readonly wanted: string;
  /** `node --version` on the person's PATH, or null when there's no node there. */
  readonly have: string | null;
  /** Whether it fits; null when that can't be told. */
  readonly fits: boolean | null;
}

export interface RunPlan {
  readonly packageManager: PackageManager;
  /** Null when the project doesn't say which Node it needs. */
  readonly node: NodeCheck | null;
  /** node_modules at the project's root. */
  readonly installed: boolean;
  /** The root package.json's scripts, `dev` first. */
  readonly scripts: readonly Script[];
  /** The script the Run button starts: `dev`, else `start`, else none. */
  readonly main: string | null;
  /** A development compose file (from the root), or null. */
  readonly compose: string | null;
  /** Each example and the .env beside it. */
  readonly envFiles: readonly EnvFile[];
  readonly missing: readonly MissingVariable[];
}

// As the file agent tells examples from secrets (workspace/agent isSecretFile): these three are examples.
export const EXAMPLES = /(^|\/)\.env\.(example|sample|template)$/;
const COMPOSE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
/** Where an app's variables can be set, beside its example; the process environment counts too. */
export const SET_IN = ['.env', '.env.local', '.env.development', '.env.development.local'];

export function packageManagerOf(root: string): PackageManager {
  const declared = readJson(join(root, 'package.json'))?.packageManager;
  if (typeof declared === 'string') {
    const name = declared.split('@')[0];
    if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
  }
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/**
 * The project's run plan. `files` is its file list (git's, as the file tree has it), so examples and compose files
 * are found anywhere without walking node_modules.
 */
export function detectRunPlan(
  root: string,
  files: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  nodeVersion: string | null = null,
): RunPlan {
  const manifest = readJson(join(root, 'package.json'));
  const scriptsObject = manifest?.scripts;
  const engines = manifest?.engines;
  const wanted =
    typeof engines === 'object' && engines !== null
      ? (engines as Record<string, unknown>).node
      : undefined;
  const node: NodeCheck | null =
    typeof wanted === 'string'
      ? {
          wanted,
          have: nodeVersion,
          fits: nodeVersion === null ? false : nodeFits(wanted, nodeVersion),
        }
      : null;
  const scripts: Script[] =
    typeof scriptsObject === 'object' && scriptsObject !== null
      ? Object.entries(scriptsObject as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([name, command]) => ({ name, command }))
      : [];
  const main = ['dev', 'start'].find((name) => scripts.some((s) => s.name === name)) ?? null;
  scripts.sort((a, b) => Number(b.name === main) - Number(a.name === main));

  // A development compose file first (docker-compose.dev.yml, docker/development/compose.yml), else the root one.
  const composes = files.filter((file) => COMPOSE.test(file));
  const compose =
    composes.find((file) => /(^|[/.-])dev(elopment)?([/.-]|$)/.test(file)) ??
    composes.find((file) => !file.includes('/')) ??
    null;

  const missing: MissingVariable[] = [];
  const envFiles: EnvFile[] = [];
  for (const example of files.filter((file) => EXAMPLES.test(file)).sort()) {
    const folder = dirname(example) === '.' ? '' : `${dirname(example)}/`;
    if (!envFiles.some((f) => f.file === `${folder}.env`)) {
      envFiles.push({
        example,
        file: `${folder}.env`,
        exists: existsSync(join(root, folder, '.env')),
      });
    }
    const set = new Set<string>(Object.keys(env).filter((name) => (env[name] ?? '') !== ''));
    for (const name of SET_IN) {
      for (const key of parseEnvSet(readText(join(root, folder, name)))) set.add(key);
    }
    for (const { name, required } of parseExample(readText(join(root, example)))) {
      if (!set.has(name))
        missing.push({ name, listedIn: example, file: `${folder}.env`, required });
    }
  }

  return {
    packageManager: packageManagerOf(root),
    node,
    installed: existsSync(join(root, 'node_modules')),
    scripts,
    main,
    compose,
    envFiles,
    missing,
  };
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
