// The grammars the engine ships (phase 4, ADR 0023) and the files each one parses. Every file of
// these languages is parsed; everything else is listed and counted, never guessed at (decisions
// log, 9 Nov 2026).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';

export type LanguageId =
  'typescript' | 'tsx' | 'javascript' | 'css' | 'json' | 'html' | 'markdown' | 'markdown-inline';

/** Each grammar's WebAssembly file name; the bundle in a workspace has them all in one folder. */
export const GRAMMAR_FILE_NAMES: Readonly<Record<LanguageId, string>> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  css: 'tree-sitter-css.wasm',
  json: 'tree-sitter-json.wasm',
  html: 'tree-sitter-html.wasm',
  markdown: 'tree-sitter-markdown.wasm',
  // Markdown is parsed in two layers: blocks (headings, lists, code), then the text inside them.
  'markdown-inline': 'tree-sitter-markdown-inline.wasm',
};
/** tree-sitter's own runtime. */
export const RUNTIME_FILE_NAME = 'web-tree-sitter.wasm';

/**
 * Where each file is in this repository: the grammar's own npm package, or, for Markdown, which no
 * package ships as WebAssembly, our reproducible build (tools/grammars/build-markdown.sh). Resolved
 * when asked, so the bundled engine (which has no node_modules) never resolves them.
 */
export function packagedGrammarFiles(): Readonly<Record<LanguageId | 'runtime', string>> {
  const require = createRequire(import.meta.url);
  const ours = (file: string) => fileURLToPath(new URL(`../grammars/${file}`, import.meta.url));
  return {
    runtime: require.resolve(`web-tree-sitter/${RUNTIME_FILE_NAME}`),
    typescript: require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm'),
    tsx: require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm'),
    javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
    css: require.resolve('tree-sitter-css/tree-sitter-css.wasm'),
    json: require.resolve('tree-sitter-json/tree-sitter-json.wasm'),
    html: require.resolve('tree-sitter-html/tree-sitter-html.wasm'),
    markdown: ours(GRAMMAR_FILE_NAMES.markdown),
    'markdown-inline': ours(GRAMMAR_FILE_NAMES['markdown-inline']),
  };
}

// Extensions are matched without regard to case (README.MD is Markdown). JSX is part of the
// JavaScript grammar; TSX needs its own because `<T>(x)` means different things in TS and TSX.
const EXTENSIONS: Readonly<Record<string, LanguageId>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  css: 'css',
  json: 'json',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  // MDX is Markdown with JSX components; no MDX grammar is maintained, so it's read as Markdown and
  // marked as partly read (owner, 9 Nov 2026).
  mdx: 'markdown',
};

/** What a grammar can't read in a file it parses, so the page can say so instead of implying more. */
export type Limitation = 'mdx-components';

const LIMITATIONS: Readonly<Record<string, Limitation>> = { mdx: 'mdx-components' };

function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null; // no extension, or a dotfile such as .gitignore
  return name.slice(dot + 1).toLowerCase();
}

/** The language a path is parsed as, or null when we ship no grammar for it. */
export function languageOf(path: string): LanguageId | null {
  const extension = extensionOf(path);
  return extension === null ? null : (EXTENSIONS[extension] ?? null);
}

/** What parsing a path leaves unread, or null when its grammar reads all of it. */
export function limitationOf(path: string): Limitation | null {
  const extension = extensionOf(path);
  return extension === null ? null : (LIMITATIONS[extension] ?? null);
}

let loading: Promise<ReadonlyMap<LanguageId, Language>> | undefined;
let directory: string | undefined;

/**
 * Loads the runtime and grammars from one folder instead of their packages: the bundled engine in a
 * workspace (ADR 0025). Call before the first `loadGrammars`.
 */
export function useGrammarDirectory(folder: string): void {
  if (loading !== undefined) throw new Error('The grammars are already loaded.');
  directory = folder;
}

/** Starts tree-sitter's runtime and loads every grammar, once per process. */
export function loadGrammars(): Promise<ReadonlyMap<LanguageId, Language>> {
  loading ??= (async () => {
    const files: Readonly<Record<LanguageId | 'runtime', string>> =
      directory === undefined
        ? packagedGrammarFiles()
        : {
            runtime: join(directory, RUNTIME_FILE_NAME),
            ...(Object.fromEntries(
              Object.entries(GRAMMAR_FILE_NAMES).map(([id, name]) => [
                id,
                join(directory ?? '', name),
              ]),
            ) as Record<LanguageId, string>),
          };
    await Parser.init({ locateFile: () => files.runtime });
    const entries = await Promise.all(
      (Object.keys(GRAMMAR_FILE_NAMES) as LanguageId[]).map(
        async (id) => [id, await Language.load(files[id])] as const,
      ),
    );
    return new Map(entries);
  })();
  return loading;
}
