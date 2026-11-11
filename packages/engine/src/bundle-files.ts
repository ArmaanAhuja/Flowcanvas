// What the host copies into a workspace to run the engine (ADR 0025): the bundled scripts, the WebAssembly they
// load and TypeScript, all in dist/workspace/, plus a version that changes whenever any of them does.
import { GRAMMAR_FILE_NAMES, RUNTIME_FILE_NAME } from './grammars.js';

export const ENGINE_BUNDLE_DIR = new URL('../dist/workspace/', import.meta.url);

/** TypeScript (phase 5, ADR 0026 §7): typescript.js and its lib.*.d.ts files, as one archive the host unpacks into
 * `typescript/` (one copy instead of over a hundred). */
export const ENGINE_TYPESCRIPT_ARCHIVE = 'typescript.tar';
/** The semantic worker's script (phase 5), started by main.js in a thread of its own. */
export const ENGINE_SEMANTICS_WORKER = 'semantics-worker.js';

export const ENGINE_BUNDLE_FILES: readonly string[] = [
  'main.js',
  ENGINE_SEMANTICS_WORKER,
  ENGINE_TYPESCRIPT_ARCHIVE,
  RUNTIME_FILE_NAME,
  ...Object.values(GRAMMAR_FILE_NAMES),
];

/** SHA-256 over every file above, written by the bundle script; the host skips the copy when it matches. */
export const ENGINE_BUNDLE_VERSION_FILE = 'version.txt';
