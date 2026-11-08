// The grammars the engine ships (phase 4, ADR 0023) and the files each one parses. Every file of
// these languages is parsed; everything else is listed and counted, never guessed at (decisions
// log, 9 Nov 2026).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';

export type LanguageId =
  'typescript' | 'tsx' | 'javascript' | 'css' | 'json' | 'html' | 'markdown' | 'markdown-inline';

const require = createRequire(import.meta.url);
const ours = (file: string) => fileURLToPath(new URL(`../grammars/${file}`, import.meta.url));

/**
 * Where each grammar's WebAssembly comes from: the grammar's own npm package, or, for Markdown,
 * which no package ships as WebAssembly, our reproducible build (tools/grammars/build-markdown.sh).
 */
export const GRAMMAR_FILES: Readonly<Record<LanguageId, string>> = {
  typescript: require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm'),
  tsx: require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm'),
  javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
  css: require.resolve('tree-sitter-css/tree-sitter-css.wasm'),
  json: require.resolve('tree-sitter-json/tree-sitter-json.wasm'),
  html: require.resolve('tree-sitter-html/tree-sitter-html.wasm'),
  markdown: ours('tree-sitter-markdown.wasm'),
  // Markdown is parsed in two layers: blocks (headings, lists, code), then the text inside them.
  'markdown-inline': ours('tree-sitter-markdown-inline.wasm'),
};

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

/** Starts tree-sitter's runtime and loads every grammar, once per process. */
export function loadGrammars(): Promise<ReadonlyMap<LanguageId, Language>> {
  loading ??= (async () => {
    await Parser.init();
    const entries = await Promise.all(
      Object.entries(GRAMMAR_FILES).map(
        async ([id, file]) => [id as LanguageId, await Language.load(file)] as const,
      ),
    );
    return new Map(entries);
  })();
  return loading;
}
