// What the host copies into a workspace to run the engine (ADR 0025): one bundled script and the WebAssembly
// it loads, all in dist/workspace/, plus a version that changes whenever any of them does.
import { GRAMMAR_FILE_NAMES, RUNTIME_FILE_NAME } from './grammars.js';

export const ENGINE_BUNDLE_DIR = new URL('../dist/workspace/', import.meta.url);

export const ENGINE_BUNDLE_FILES: readonly string[] = [
  'main.js',
  RUNTIME_FILE_NAME,
  ...Object.values(GRAMMAR_FILE_NAMES),
];

/** SHA-256 over every file above, written by the bundle script; the host skips the copy when it matches. */
export const ENGINE_BUNDLE_VERSION_FILE = 'version.txt';
