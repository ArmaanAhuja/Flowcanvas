// `pnpm docs:check` (CI, and before every milestone report) and `pnpm docs:update` (rewrites the counts): the living
// docs held to the code. See checks.ts for what each check holds them to.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  architectureDependencies,
  architectureParts,
  buildSteps,
  countsIn,
  pathsNamed,
  phasesFromStatus,
  runAndFeatures,
  stamps,
  stillToCome,
  updatedDate,
  withCounts,
  type Finding,
} from './checks.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(repo, path), 'utf8');
const update = process.argv.includes('--update');

/** Docs that describe the project as it is now (the historical records are left as written). */
const LIVING = ['README.md', 'docs/RUN-AND-FEATURES.md', 'docs/STATUS.md', 'ARCHITECTURE.md'];
const RUN = 'docs/RUN-AND-FEATURES.md';

/** The workspace's packages: pnpm-workspace.yaml's globs (`apps/*`, `e2e`). */
function workspacePackages(): string[] {
  const globs = [...read('pnpm-workspace.yaml').matchAll(/^ {2}- '([^']+)'/gm)].map(
    (m) => m[1] ?? '',
  );
  return globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return existsSync(join(repo, glob, 'package.json')) ? [glob] : [];
    const parent = glob.slice(0, -2);
    if (!existsSync(join(repo, parent))) return [];
    return readdirSync(join(repo, parent))
      .map((name) => `${parent}/${name}`)
      .filter((dir) => existsSync(join(repo, dir, 'package.json')));
  });
}

/** How many tests a package's own command runs, by listing them with the same arguments. */
function vitestCount(dir: string, script: string | undefined): number {
  if (!script?.startsWith('vitest run')) return 0;
  const args =
    script
      .slice('vitest run'.length)
      .trim()
      .match(/'[^']*'|\S+/g) ?? [];
  const output = execFileSync(
    'npx',
    ['vitest', 'list', ...args.map((a) => a.replace(/^'|'$/g, '')), '--json'],
    {
      cwd: join(repo, dir),
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return (JSON.parse(output.slice(output.indexOf('['))) as unknown[]).length;
}

function playwrightCount(config: string): number {
  try {
    const output = execFileSync('npx', ['playwright', 'test', '--list', '--config', config], {
      cwd: join(repo, 'e2e'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return Number(/Total: (\d+) tests?/.exec(output)?.[1] ?? Number.NaN);
  } catch (error) {
    const said = (error as { stderr?: string }).stderr ?? String(error);
    throw new Error(`couldn't list the tests of e2e/${config}:\n${said.slice(0, 2000)}`, {
      cause: error,
    });
  }
}

/**
 * The catalogue's screenshots are one per story and theme, read from the built catalogue (its index.json): built
 * first, so the count never depends on what happens to be on the machine (found on CI, 13 Nov 2026). Turborepo
 * replays it from its cache when nothing changed.
 */
function buildCatalogue(): void {
  execFileSync('pnpm', ['-s', 'turbo', 'run', 'build-storybook', '--filter=@flowcanvas/ui'], {
    cwd: repo,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * How many tests `pnpm test` runs: each package's own total, as Vitest reports it. Read from the run itself, which
 * Turborepo replays from its cache when nothing changed (on CI, right after the tests ran): `vitest list` doesn't
 * expand `it.each` (it found 3 of the tokens' 49 tests).
 */
/** Terminal colours in the output (escape, `[`, numbers, `m`). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function unitCount(): number {
  // `--log-prefix=task`: in GitHub Actions, Turborepo groups each package's output and drops the `package:test:`
  // prefix read here (the count came out as 0 on CI, 13 Nov 2026).
  const output = execFileSync('pnpm', ['-s', 'turbo', 'run', 'test', '--log-prefix=task'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const totals = [...output.replace(ANSI, '').matchAll(/:test:\s+Tests\s+[^\n]*\((\d+)\)/g)];
  // No totals read is a failure to count, never a count of 0.
  if (totals.length === 0)
    throw new Error('couldn’t read the unit tests’ totals from `turbo run test`');
  return totals.reduce((sum, match) => sum + Number(match[1]), 0);
}

function counts(packages: readonly string[]): Map<string, number> {
  const unit = unitCount();
  let docker = 0;
  for (const dir of packages) {
    const scripts = (
      JSON.parse(read(join(dir, 'package.json'))) as { scripts?: Record<string, string> }
    ).scripts;
    // Listing is exact here: no Docker test is table-driven (`it.each`), which listing wouldn't expand.
    docker += vitestCount(dir, scripts?.['test:docker']);
  }
  return new Map([
    ['unit', unit],
    ['docker', docker],
    ['walkthroughs', playwrightCount('playwright.config.ts')],
    ['screenshots', (buildCatalogue(), playwrightCount('playwright.visual.config.ts'))],
  ]);
}

const findings: Finding[] = [];
const { accepted, inProgress } = phasesFromStatus(read('docs/STATUS.md'));
const acceptedSet = new Set(accepted);
const version = (JSON.parse(read('package.json')) as { version: string }).version;
const packages = workspacePackages();

// RUN-AND-FEATURES: the release, the progress, where the work is, the phase sections, and the counts.
findings.push(
  ...runAndFeatures(read(RUN), { version, changelog: read('CHANGELOG.md'), accepted, inProgress }),
);
const latestCommit = new Date(
  execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: repo, encoding: 'utf8' }).trim(),
);
findings.push(...updatedDate(read(RUN), latestCommit));
const real = counts(packages);
const doc = read(RUN);
if (update) {
  writeFileSync(join(repo, RUN), withCounts(doc, real));
  console.log(
    `Counts written to ${RUN}: ${[...real].map(([k, v]) => `${k} ${String(v)}`).join(', ')}`,
  );
} else {
  const said = countsIn(doc);
  for (const [name, value] of real) {
    const shown = said.get(name);
    if (shown === undefined) findings.push({ where: RUN, problem: `has no count:${name} block` });
    else if (shown !== value.toLocaleString('en-US')) {
      findings.push({
        where: RUN,
        problem: `says ${shown} ${name}; there are ${value.toLocaleString('en-US')} (run pnpm docs:update)`,
      });
    }
  }
}

// build-steps: no step left to do in an accepted phase.
findings.push(...buildSteps(read('docs/build-steps.md'), acceptedSet));

// Living docs: every path they name exists.
for (const file of LIVING) {
  for (const { path, line } of pathsNamed(read(file))) {
    if (!existsSync(join(repo, path))) {
      findings.push({
        where: `${file}:${String(line)}`,
        problem: `names ${path}, which doesn't exist`,
      });
    }
  }
}

// ARCHITECTURE: every package in its parts table, each row naming every source folder, and the dependencies as
// package.json has them (owner, 13 Nov 2026: it still said "end of phase 1b" in phase 7, with parts missing).
const architecture = read('ARCHITECTURE.md');
const manifests = packages.map((dir) => ({
  dir,
  json: JSON.parse(read(join(dir, 'package.json'))) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
}));
for (const { dir, json } of manifests) {
  if (!architecture.includes(json.name) && !architecture.includes(`\`${dir}\``)) {
    findings.push({ where: 'ARCHITECTURE.md', problem: `doesn't mention ${json.name} (${dir})` });
  }
}
/** Folders that hold a package's test set-up, not a part of it. */
const NOT_PARTS = new Set(['test', '__tests__', 'fixtures']);
findings.push(
  ...architectureParts(
    architecture,
    manifests.map(({ dir, json }) => ({
      name: json.name,
      folders: existsSync(join(repo, dir, 'src'))
        ? readdirSync(join(repo, dir, 'src'), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !NOT_PARTS.has(entry.name))
            .map((entry) => entry.name)
        : [],
    })),
  ),
);
const SCOPE = '@flowcanvas/';
findings.push(
  ...architectureDependencies(
    architecture,
    new Map(
      manifests
        .map(
          ({ json }) =>
            [
              json.name.slice(SCOPE.length),
              Object.keys({ ...json.dependencies, ...json.devDependencies })
                .filter((dep) => dep.startsWith(SCOPE))
                .map((dep) => dep.slice(SCOPE.length)),
            ] as const,
        )
        .filter(([, deps]) => deps.length > 0),
    ),
  ),
);

// Every tracked text file outside the historical records, code and site text included (not only comments, and not
// only docs): no accepted phase still to come, and no stamp dating it to a phase the work has moved past. CLAUDE.md is
// the owner's brief, with its own dated history ("Your first response", kept for reference): left as written.
const HISTORICAL =
  /^(docs\/(reference|reports|adr)\/|docs\/build-steps\.md$|docs\/decisions-log\.md$|CHANGELOG\.md$|CLAUDE\.md$|corpus\/labels\/|tools\/docs-check\/src\/checks\.test\.ts$)/;
const TEXT = /\.(md|ts|tsx|mts|js|mjs|css|json|jsonc|ya?ml|html|sh|txt)$/;
const current = inProgress.length > 0 ? inProgress : accepted.slice(-1);
const tracked = execFileSync('git', ['ls-files'], {
  cwd: repo,
  encoding: 'utf8',
  maxBuffer: 1 << 26,
})
  .split('\n')
  .filter((file) => TEXT.test(file) && !HISTORICAL.test(file) && existsSync(join(repo, file)));
for (const file of tracked) {
  const text = read(file);
  findings.push(...stillToCome(text, acceptedSet, file), ...stamps(text, current, file));
}

if (findings.length > 0) {
  for (const finding of findings) console.log(`${finding.where}: ${finding.problem}`);
  console.log(`\n${String(findings.length)} things in the docs disagree with the code.`);
  process.exitCode = 1;
} else {
  console.log('The living docs agree with the code.');
}
