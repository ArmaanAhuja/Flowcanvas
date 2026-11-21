// What the desktop walkthroughs share: a copy of a corpus fork at its pin, and the real Electron app launched on it,
// with its own data folder (the person's recent projects are never touched).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const appDir = fileURLToPath(new URL('../../apps/desktop/', import.meta.url));
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as string;
const manifest = JSON.parse(
  readFileSync(new URL('../../corpus/manifest.json', import.meta.url), 'utf8'),
) as { repos: { id: string; commit: string }[] };
// Where `pnpm corpus:fetch` keeps the forks (corpus/src/cache.ts): the same rules.
const cache =
  process.env.FLOWCANVAS_CORPUS_CACHE ??
  join(
    process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '', '.cache'),
    'flowcanvas',
    'corpus',
  );

/** A copy of the pinned fork in `base`, so nothing a walkthrough does touches the cached clone. */
export function cloneFork(id: string, base: string): string {
  const repo = manifest.repos.find((r) => r.id === id);
  if (repo === undefined) throw new Error(`No ${id} in corpus/manifest.json`);
  const folder = join(base, id);
  execFileSync('git', [
    'clone',
    '--quiet',
    '--shared',
    join(cache, `${id}@${repo.commit.slice(0, 12)}`),
    folder,
  ]);
  execFileSync('git', ['-C', folder, 'checkout', '--quiet', repo.commit]);
  return folder;
}

/**
 * The app, started as Electron whatever started the test (VS Code sets ELECTRON_RUN_AS_NODE), with its data in
 * `base`. `path` puts folders first on the PATH the app and its processes get (a project's own Node version); `env`
 * is set as the person's shell would have it.
 */
export async function launchApp(
  base: string,
  args: readonly string[],
  options: {
    readonly path?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
  const PATH = [...(options.path ?? []), env.PATH ?? ''].join(':');
  const app = await electron.launch({
    executablePath: process.env.FLOWCANVAS_DESKTOP_EXECUTABLE ?? electronPath,
    args: process.env.FLOWCANVAS_DESKTOP_EXECUTABLE === undefined ? [appDir, ...args] : [...args],
    env: { ...env, ...options.env, PATH, XDG_CONFIG_HOME: join(base, 'config') },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page };
}
