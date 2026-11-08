// Which language a file is, for highlighting and the status bar (phase 3: what a web project has). Each
// language's parser loads only when a file of that kind opens.
import type { Extension } from '@codemirror/state';

export interface Language {
  /** Shown in the status bar. */
  readonly name: string;
  readonly load: () => Promise<Extension>;
}

const typescript = (jsx: boolean) => async () =>
  (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx });
const javascript = (jsx: boolean) => async () =>
  (await import('@codemirror/lang-javascript')).javascript({ jsx });

const PLAIN: Language = { name: 'Plain text', load: () => Promise.resolve([]) };

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ts: { name: 'TypeScript', load: typescript(false) },
  mts: { name: 'TypeScript', load: typescript(false) },
  cts: { name: 'TypeScript', load: typescript(false) },
  tsx: { name: 'TypeScript JSX', load: typescript(true) },
  js: { name: 'JavaScript', load: javascript(false) },
  mjs: { name: 'JavaScript', load: javascript(false) },
  cjs: { name: 'JavaScript', load: javascript(false) },
  jsx: { name: 'JavaScript JSX', load: javascript(true) },
  json: { name: 'JSON', load: async () => (await import('@codemirror/lang-json')).json() },
  css: { name: 'CSS', load: async () => (await import('@codemirror/lang-css')).css() },
  html: { name: 'HTML', load: async () => (await import('@codemirror/lang-html')).html() },
  md: {
    name: 'Markdown',
    load: async () => (await import('@codemirror/lang-markdown')).markdown(),
  },
  mdx: {
    name: 'Markdown',
    load: async () => (await import('@codemirror/lang-markdown')).markdown(),
  },
};

export function languageFor(path: string): Language {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? PLAIN : (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? PLAIN);
}

/** The indentation a file uses, from its first indented lines: "Spaces: 2", "Spaces: 4" or "Tabs". */
export function detectIndent(text: string): { readonly unit: string; readonly label: string } {
  const counts = new Map<number, number>();
  let tabs = 0;
  let seen = 0;
  for (const line of text.split('\n')) {
    if (seen >= 200) break;
    if (line.startsWith('\t')) {
      tabs += 1;
      seen += 1;
      continue;
    }
    const spaces = /^( +)\S/.exec(line)?.[1]?.length;
    if (spaces === undefined) continue;
    seen += 1;
    for (const size of [2, 4, 8])
      if (spaces % size === 0) counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  if (tabs > seen / 2 && tabs > 0) return { unit: '\t', label: 'Tabs' };
  // The largest size that fits nearly every indented line (a 4-space file also fits 2).
  for (const size of [8, 4, 2]) {
    const fits = counts.get(size) ?? 0;
    if (seen > 0 && fits >= seen * 0.9 && fits > 0) {
      return { unit: ' '.repeat(size), label: `Spaces: ${String(size)}` };
    }
  }
  return { unit: '  ', label: 'Spaces: 2' };
}
