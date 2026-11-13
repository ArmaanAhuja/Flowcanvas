// `pnpm docs:check` (CI, and before every milestone report) and `pnpm docs:update` (rewrites the counts): the living
// docs held to the code. See checks.ts for what each check holds them to.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSteps,
  commentsOf,
  countsIn,
  pathsNamed,
  phasesFromStatus,
  runAndFeatures,
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

/** Source files whose comments are read: every package's own code, never dependencies or builds. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(repo, dir)).flatMap((name) => {
    if (
      ['node_modules', 'dist', 'storybook-static', 'test-results', 'playwright-report'].includes(
        name,
      )
    ) {
      return [];
    }
    const path = join(dir, name);
    if (statSync(join(repo, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|css)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
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

// Living docs: no accepted phase still to come, and every path they name exists.
for (const file of LIVING) {
  const text = read(file);
  findings.push(...stillToCome(text, acceptedSet, file));
  for (const { path, line } of pathsNamed(text)) {
    if (!existsSync(join(repo, path))) {
      findings.push({
        where: `${file}:${String(line)}`,
        problem: `names ${path}, which doesn't exist`,
      });
    }
  }
}

// ARCHITECTURE: every package in its parts.
const architecture = read('ARCHITECTURE.md');
for (const dir of packages) {
  const name = (JSON.parse(read(join(dir, 'package.json'))) as { name: string }).name;
  if (!architecture.includes(name) && !architecture.includes(`\`${dir}\``)) {
    findings.push({ where: 'ARCHITECTURE.md', problem: `doesn't mention ${name} (${dir})` });
  }
}

// Comments in the code: no accepted phase still to come.
for (const dir of packages) {
  for (const file of sourceFiles(dir)) {
    for (const comment of commentsOf(read(file))) {
      for (const finding of stillToCome(comment.text, acceptedSet, file)) {
        const line = Number(finding.where.split(':').at(-1)) + comment.line - 1;
        findings.push({
          where: `${relative(repo, join(repo, file))}:${String(line)}`,
          problem: finding.problem,
        });
      }
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.log(`${finding.where}: ${finding.problem}`);
  console.log(`\n${String(findings.length)} things in the docs disagree with the code.`);
  process.exitCode = 1;
} else {
  console.log('The living docs agree with the code.');
}
