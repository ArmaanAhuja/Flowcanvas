// Builds the Linux packages (build plan v2, phase 1): an AppImage and a .deb, in release/ (FLOWCANVAS_PACKAGES picks
// some: `FLOWCANVAS_PACKAGES=AppImage pnpm package` where the .deb tooling can't run). Run after `pnpm build`
// (which assembled build/). The app is staged on its own first (the two bundled files and a package.json without
// dependencies), so electron-builder never walks pnpm's node_modules: everything the app needs is bundled.
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';

const here = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const root = JSON.parse(readFileSync(here('../../package.json'), 'utf8')) as { version: string };
const own = JSON.parse(readFileSync(here('package.json'), 'utf8')) as {
  productName: string;
  description: string;
};
const electronPackage = createRequire(here('package.json')).resolve('electron/package.json');
const electronVersion = (JSON.parse(readFileSync(electronPackage, 'utf8')) as { version: string })
  .version;

const LAUNCHER = `#!/bin/sh
# Flowcanvas: always start the app, even where ELECTRON_RUN_AS_NODE is set (it would start Electron as plain Node).
unset ELECTRON_RUN_AS_NODE
exec "$(dirname "$(readlink -f "$0")")/flowcanvas-bin" "$@"
`;

const stage = here('build/stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'build'), { recursive: true });
cpSync(here('build/app'), join(stage, 'build/app'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'flowcanvas',
      productName: own.productName,
      version: root.version,
      description: own.description,
      main: 'build/app/main.mjs',
      type: 'module',
      // Shown by package managers; no personal address.
      author: { name: 'Flowcanvas' },
      homepage: 'https://github.com/ArmaanAhuja/Flowcanvas',
    },
    null,
    2,
  )}\n`,
);

await build({
  projectDir: stage,
  targets: Platform.LINUX.createTarget(
    (process.env.FLOWCANVAS_PACKAGES ?? 'AppImage,deb').split(','),
  ),
  config: {
    appId: 'dev.flowcanvas.desktop',
    productName: own.productName,
    electronVersion,
    // The Electron already downloaded for development: no second download.
    electronDist: join(dirname(electronPackage), 'dist'),
    npmRebuild: false,
    directories: { output: here('release') },
    files: ['build/app/**', 'package.json'],
    extraResources: [
      { from: here('build/web'), to: 'web' },
      { from: here('build/engine'), to: 'engine' },
    ],
    linux: {
      executableName: 'flowcanvas',
      category: 'Development',
      maintainer: 'Flowcanvas',
      synopsis: 'Understand what your AI coding agent does',
      desktop: { entry: { StartupWMClass: own.productName } },
    },
    deb: { depends: ['git'] },
    // The `flowcanvas` command is a small launcher: Electron starts as plain Node when ELECTRON_RUN_AS_NODE is set
    // (VS Code's terminals set it), so the launcher clears it and starts the real binary, renamed flowcanvas-bin.
    // The engine sets it again for its own child process on purpose (folders.ts).
    afterPack: (context) => {
      const binary = join(context.appOutDir, 'flowcanvas');
      renameSync(binary, `${binary}-bin`);
      writeFileSync(binary, LAUNCHER);
      chmodSync(binary, 0o755);
      return Promise.resolve();
    },
  },
});
process.stdout.write(`packaged ${root.version} into ${here('release')}\n`);
