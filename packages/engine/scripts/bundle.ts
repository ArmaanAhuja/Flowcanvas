// Bundles the engine for workspaces (ADR 0025): src/main.ts and everything it imports (web-tree-sitter, the
// agent's file list and watcher) into dist/workspace/main.js, beside the runtime and grammar WebAssembly.
// A workspace has Node but no node_modules, so the bundle needs nothing but Node's built-in modules.
// Run by `pnpm build`, after `tsc`.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  ENGINE_BUNDLE_DIR,
  ENGINE_BUNDLE_FILES,
  ENGINE_BUNDLE_VERSION_FILE,
} from '../src/bundle-files.js';
import { packagedGrammarFiles } from '../src/grammars.js';

const out = fileURLToPath(ENGINE_BUNDLE_DIR);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
  outfile: `${out}main.js`,
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
