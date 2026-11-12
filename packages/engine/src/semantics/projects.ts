// The project as TypeScript sees it (phase 5, ADR 0026 §2–4): its tsconfigs, its own packages, which packages
// depend on which, and each config's options (the config's own, plus `paths` to the project's packages and
// analysis defaults where it leaves an option unset).
import { dirname, join, posix } from 'node:path';
import type * as TS from 'typescript';
import type { ProjectHost } from './host.js';

export type TypeScript = typeof TS;

export interface WorkspacePackage {
  readonly name: string;
  /** Project-relative folder ('' for the root). */
  readonly dir: string;
  /** Names of the project's other packages it depends on. */
  readonly dependsOn: readonly string[];
  /** `paths` entries that resolve its imports to its source files (absolute paths). */
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

export interface ProjectConfig {
  /** Project-relative path of the tsconfig.json; for an inferred program, `<folder>/(inferred)`. */
  readonly path: string;
  /** The package it belongs to (the nearest package.json above it), if any. */
  readonly packageName: string | null;
  /**
   * An inferred program (ADR 0027 §2): the package's source files that no tsconfig.json includes, with the analysis
   * defaults and `allowJs`, as TypeScript's own editors do. LibreChat's whole Express backend is one.
   */
  readonly inferred?: true;
}

export interface ParsedConfig {
  readonly options: TS.CompilerOptions;
  /** Absolute paths of the files it includes (never inside node_modules). */
  readonly fileNames: readonly string[];
}

/** Where a config leaves an option unset (ADR 0026 §4): without jsx, TypeScript drops resolved .tsx files. */
export function analysisDefaults(ts: TypeScript): TS.CompilerOptions {
  return {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    allowJs: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
  };
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/** The `paths` for a package, from its exports (subpaths and `*` patterns), else types/typings/main. */
export function packagePaths(
  name: string,
  folder: string,
  manifest: Record<string, unknown>,
): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  const target = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const conditions = value as Record<string, unknown>;
    return target(
      conditions.types ?? conditions.import ?? conditions.default ?? conditions.require,
    );
  };
  const exportsField = manifest.exports;
  const subpaths =
    typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)
      ? Object.entries(exportsField as Record<string, unknown>).filter(([key]) =>
          key.startsWith('.'),
        )
      : [];
  if (subpaths.length > 0) {
    for (const [key, value] of subpaths) {
      const file = target(value);
      if (file === undefined || !(SOURCE.test(file) || file.includes('*'))) continue;
      paths[key === '.' ? name : `${name}${key.slice(1)}`] = [join(folder, file)];
    }
  } else {
    const main = [manifest.types, manifest.typings, manifest.main].find(
      (value): value is string => typeof value === 'string',
    );
    paths[name] = [join(folder, main ?? 'index.ts')];
  }
  paths[`${name}/*`] ??= [join(folder, '*')];
  return paths;
}

export class ProjectModel {
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  readonly configs: readonly ProjectConfig[];
  readonly #ts: TypeScript;
  readonly #root: string;
  readonly #host: ProjectHost;
  readonly #parsed = new Map<string, ParsedConfig | null>();
  readonly #workspacePaths: Record<string, string[]>;
  readonly #files: readonly string[];
  readonly #packageDirs: readonly WorkspacePackage[];
  /** The inferred programs' files, by config path; worked out once every tsconfig is parsed, until `forget`. */
  #inferred: Map<string, { readonly config: ProjectConfig; readonly files: string[] }> | undefined;

  /**
   * @param files the project's files (project-relative, the agent's list: git's, never secret ones)
   * @param packages the project's own packages, as found by `findPackages`
   */
  constructor(
    ts: TypeScript,
    root: string,
    host: ProjectHost,
    files: readonly string[],
    packages: ReadonlyMap<string, WorkspacePackage>,
  ) {
    this.#ts = ts;
    this.#root = root;
    this.#host = host;
    this.packages = packages;
    this.#files = files;
    const packageDirs = [...packages.values()].sort((a, b) => b.dir.length - a.dir.length);
    this.#packageDirs = packageDirs;
    this.configs = files
      .filter(
        (file) =>
          posix.basename(file) === 'tsconfig.json' && !file.split('/').includes('node_modules'),
      )
      .map((path) => {
        const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
        const owner = packageDirs.find(
          (p) => p.dir === '' || dir === p.dir || dir.startsWith(`${p.dir}/`),
        );
        return { path, packageName: owner?.name ?? null };
      });
    this.#workspacePaths = {};
    for (const pkg of packages.values()) {
      for (const [key, value] of Object.entries(pkg.paths)) this.#workspacePaths[key] = [...value];
    }
  }

  /** Every program's config: the tsconfig.json files, then the inferred programs for the source files they leave out. */
  get allConfigs(): readonly ProjectConfig[] {
    return [...this.configs, ...[...this.#inferredPrograms().values()].map((p) => p.config)];
  }

  #inferredPrograms(): Map<string, { readonly config: ProjectConfig; readonly files: string[] }> {
    if (this.#inferred !== undefined) return this.#inferred;
    const covered = new Set<string>();
    for (const config of this.configs) {
      for (const file of this.parse(config)?.fileNames ?? []) covered.add(file);
    }
    const byPackage = new Map<string, { config: ProjectConfig; files: string[] }>();
    for (const file of this.#files) {
      if (
        !SOURCE.test(file) ||
        DECLARATION.test(file) ||
        file.split('/').includes('node_modules')
      ) {
        continue;
      }
      const absolute = join(this.#root, file);
      if (covered.has(absolute)) continue;
      const owner = this.#packageDirs.find((p) => p.dir === '' || file.startsWith(`${p.dir}/`));
      const dir = owner?.dir ?? '';
      let group = byPackage.get(dir);
      if (group === undefined) {
        group = {
          config: {
            path: dir === '' ? '(inferred)' : `${dir}/(inferred)`,
            packageName: owner?.name ?? null,
            inferred: true,
          },
          files: [],
        };
        byPackage.set(dir, group);
      }
      group.files.push(absolute);
    }
    this.#inferred = new Map([...byPackage.values()].map((g) => [g.config.path, g]));
    return this.#inferred;
  }

  /** A config's options and files; null when it can't be read at all. Parsed once until `forget`. */
  parse(config: ProjectConfig): ParsedConfig | null {
    const cached = this.#parsed.get(config.path);
    if (cached !== undefined) return cached;
    const ts = this.#ts;
    if (config.inferred === true) {
      const result: ParsedConfig = {
        options: {
          ...analysisDefaults(ts),
          allowJs: true,
          checkJs: false,
          paths: { ...this.#workspacePaths },
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        // By path: a service may hold the config from before a `forget`.
        fileNames: this.#inferredPrograms().get(config.path)?.files ?? [],
      };
      this.#parsed.set(config.path, result);
      return result;
    }
    const configPath = join(this.#root, config.path);
    const host = this.#host;
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      { noEmit: true },
      {
        fileExists: host.fileExists,
        readFile: host.readFile,
        readDirectory: (path, extensions, excludes, includes, depth) =>
          ts.sys
            .readDirectory(host.mapPath(path), extensions, excludes, includes, depth)
            .filter((file) => host.fileExists(file)),
        useCaseSensitiveFileNames: true,
        getCurrentDirectory: () => dirname(configPath),
        // An extends that can't be found (a package from npm): its options are lost, and the defaults fill in.
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    let result: ParsedConfig | null = null;
    if (parsed !== undefined) {
      result = {
        options: {
          ...analysisDefaults(ts),
          ...parsed.options,
          paths: { ...this.#workspacePaths, ...(parsed.options.paths ?? {}) },
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        fileNames: parsed.fileNames.filter((file) => !file.split(/[\\/]/).includes('node_modules')),
      };
    }
    this.#parsed.set(config.path, result);
    return result;
  }

  /** Parse again next time (the config or a package.json changed). */
  forget(): void {
    this.#parsed.clear();
    this.#inferred = undefined;
  }

  /** The configs whose programs include `file` (absolute); else the nearest config above it. */
  configsFor(file: string): ProjectConfig[] {
    const including = this.allConfigs.filter((config) =>
      this.parse(config)?.fileNames.includes(file),
    );
    if (including.length > 0) return including;
    const relativeDir = posix.dirname(file.slice(this.#root.length + 1));
    const nearest = [...this.configs]
      .filter((config) => {
        const dir = posix.dirname(config.path);
        return dir === '.' || relativeDir === dir || relativeDir.startsWith(`${dir}/`);
      })
      .sort((a, b) => b.path.length - a.path.length)[0];
    return nearest === undefined ? [] : [nearest];
  }

  /** Packages that depend on `name`, directly or through others. */
  dependents(name: string): Set<string> {
    const found = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.shift() ?? '';
      for (const pkg of this.packages.values()) {
        if (!found.has(pkg.name) && pkg.dependsOn.includes(current)) {
          found.add(pkg.name);
          queue.push(pkg.name);
        }
      }
    }
    return found;
  }

  /** The configs that could hold a caller of something in `file`: its own, and its package's dependents'. */
  callerConfigsFor(file: string): ProjectConfig[] {
    const own = this.configsFor(file);
    const packagesOfOwn = new Set(
      own.map((config) => config.packageName).filter((n) => n !== null),
    );
    const dependents = new Set<string>();
    for (const name of packagesOfOwn) for (const d of this.dependents(name)) dependents.add(d);
    const extra = this.allConfigs.filter(
      (config) =>
        config.packageName !== null && dependents.has(config.packageName) && !own.includes(config),
    );
    return [...own, ...extra];
  }
}

/** The project's own packages, from every package.json outside node_modules. */
export function findPackages(
  root: string,
  files: readonly string[],
  read: (path: string) => string | undefined,
): Map<string, WorkspacePackage> {
  const manifests = new Map<string, { dir: string; manifest: Record<string, unknown> }>();
  for (const file of files) {
    if (posix.basename(file) !== 'package.json' || file.split('/').includes('node_modules'))
      continue;
    try {
      const manifest = JSON.parse(read(join(root, file)) ?? '') as Record<string, unknown>;
      if (typeof manifest.name === 'string' && manifest.name !== '') {
        const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
        manifests.set(manifest.name, { dir, manifest });
      }
    } catch {
      // Not JSON: not a package we can use.
    }
  }
  const packages = new Map<string, WorkspacePackage>();
  for (const [name, { dir, manifest }] of manifests) {
    const dependsOn = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => {
      const value = manifest[field];
      return typeof value === 'object' && value !== null
        ? Object.keys(value).filter((dep) => dep !== name && manifests.has(dep))
        : [];
    });
    packages.set(name, {
      name,
      dir,
      dependsOn: [...new Set(dependsOn)],
      paths: packagePaths(name, join(root, dir), manifest),
    });
  }
  return packages;
}
