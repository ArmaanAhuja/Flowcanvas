// Bundles the engine for workspaces (ADR 0025): src/main.ts and everything it imports (web-tree-sitter, the
// agent's file list and watcher) into dist/workspace/main.js, beside the runtime and grammar WebAssembly.
// A workspace has Node but no node_modules, so the bundle needs nothing but Node's built-in modules.
// Run by `pnpm build`, after `tsc`.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  ENGINE_BUNDLE_DIR,
  ENGINE_BUNDLE_FILES,
  ENGINE_BUNDLE_VERSION_FILE,
  ENGINE_SEMANTICS_WORKER,
  ENGINE_TYPESCRIPT_ARCHIVE,
} from '../src/bundle-files.js';
import { packagedGrammarFiles } from '../src/grammars.js';

const out = fileURLToPath(ENGINE_BUNDLE_DIR);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  // The engine, and the semantic worker it starts in a thread (phase 5). TypeScript itself isn't bundled: the
  // worker loads typescript.js at run time, from beside it (ADR 0026 §7).
  entryPoints: {
    main: fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    [ENGINE_SEMANTICS_WORKER.replace(/\.js$/, '')]: fileURLToPath(
      new URL('../src/semantics/worker.ts', import.meta.url),
    ),
  },
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  // Emscripten's output (web-tree-sitter) uses `require` under Node; give the ES module one.
  banner: {
    js: "import { createRequire as __flowcanvasRequire } from 'node:module'; const require = __flowcanvasRequire(import.meta.url);",
  },
  legalComments: 'eof',
  logLevel: 'warning',
});

for (const file of Object.values(packagedGrammarFiles())) {
  await copyFile(file, `${out}${basename(file)}`);
}

// TypeScript: typescript.js and its standard library declarations, as one archive with fixed names, times and
// owners, so the same TypeScript always gives the same bytes (and the same engine version).
const require = createRequire(import.meta.url);
const typescriptLib = dirname(require.resolve('typescript/lib/typescript.js'));
const staging = await mkdtemp(join(tmpdir(), 'flowcanvas-typescript-'));
try {
  const names = (await readdir(typescriptLib)).filter(
    (name) => name === 'typescript.js' || /^lib\..*\.d\.ts$/.test(name),
  );
  for (const name of names) await copyFile(join(typescriptLib, name), join(staging, name));
  execFileSync('tar', [
    '--create',
    `--file=${out}${ENGINE_TYPESCRIPT_ARCHIVE}`,
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--mode=a+rX,u+w,go-w',
    `--directory=${staging}`,
    ...names.sort(),
  ]);
} finally {
  await rm(staging, { recursive: true, force: true });
}

// Every listed file must be there, and nothing is copied twice under one name.
const hash = createHash('sha256');
for (const name of [...ENGINE_BUNDLE_FILES].sort()) {
  hash
    .update(name)
    .update('\0')
    .update(await readFile(`${out}${name}`))
    .update('\0');
}
await writeFile(`${out}${ENGINE_BUNDLE_VERSION_FILE}`, `${hash.digest('hex')}\n`);
console.log(`engine bundle: ${String(ENGINE_BUNDLE_FILES.length)} files in dist/workspace/`);
