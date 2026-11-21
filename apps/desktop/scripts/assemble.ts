// Puts the desktop app together in build/ (build plan v2, phase 1), after `tsc` has checked the sources:
// - build/app: the main process (an ES module: the engine's bundle finds itself with import.meta.url) and the preload
//   (CommonJS, as a sandboxed preload must be), each bundled into one file (no node_modules to ship);
// - build/web: the web app as built by apps/web;
// - build/engine: the engine bundle, with TypeScript unpacked beside it as the engine expects.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENGINE_BUNDLE_DIR, ENGINE_TYPESCRIPT_ARCHIVE } from '@flowcanvas/engine/bundle';
import { build, type BuildOptions } from 'esbuild';

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const out = here('build');
const web = fileURLToPath(new URL('../../web/dist/', import.meta.url));

if (!existsSync(`${web}index.html`))
  throw new Error('Build the web app first: pnpm --filter @flowcanvas/web build');
rmSync(out, { recursive: true, force: true });

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  // Electron provides itself at run time.
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
};
await build({
  ...common,
  format: 'esm',
  entryPoints: [here('src/main.ts')],
  outfile: here('build/app/main.mjs'),
  // CommonJS dependencies bundled into a module (ws) still call require() for Node's own modules.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
await build({
  ...common,
  format: 'cjs',
  entryPoints: [here('src/preload.cts')],
  outfile: here('build/app/preload.cjs'),
});

cpSync(web, here('build/web'), { recursive: true });

const engine = here('build/engine');
cpSync(fileURLToPath(ENGINE_BUNDLE_DIR), engine, { recursive: true });
mkdirSync(`${engine}/typescript`);
execFileSync('tar', [
  '-xf',
  `${engine}/${ENGINE_TYPESCRIPT_ARCHIVE}`,
  '-C',
  `${engine}/typescript`,
]);
rmSync(`${engine}/${ENGINE_TYPESCRIPT_ARCHIVE}`);

process.stdout.write(`assembled ${out}\n`);
