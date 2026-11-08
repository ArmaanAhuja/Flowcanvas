import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'web-tree-sitter';
import { describe, expect, it } from 'vitest';
import {
  GRAMMAR_FILES,
  languageOf,
  limitationOf,
  loadGrammars,
  type LanguageId,
} from './grammars.js';

const samples: Record<LanguageId, { text: string; root: string }> = {
  typescript: {
    text: 'export function add(a: number, b: number): number { return a + b; }',
    root: 'program',
  },
  tsx: {
    text: 'export const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;',
    root: 'program',
  },
  javascript: { text: 'const Button = (props) => <button {...props} />;', root: 'program' },
  css: { text: '.panel { color: var(--text-primary); }', root: 'stylesheet' },
  json: { text: '{ "name": "rallly", "private": true }', root: 'document' },
  html: { text: '<!doctype html><html><body><p>Hi</p></body></html>', root: 'document' },
  markdown: { text: '# Title\n\nSome *text*.\n\n- one\n- two\n', root: 'document' },
  'markdown-inline': { text: 'Some *text* and a [link](https://example.com).', root: 'inline' },
};

describe('languageOf', () => {
  it.each([
    ['src/index.ts', 'typescript'],
    ['next.config.mts', 'typescript'],
    ['app/page.tsx', 'tsx'],
    ['eslint.config.mjs', 'javascript'],
    ['old/Widget.jsx', 'javascript'],
    ['styles/globals.css', 'css'],
    ['package.json', 'json'],
    ['public/index.html', 'html'],
    ['docs/README.MD', 'markdown'],
    ['blog/launch.mdx', 'markdown'],
  ])('parses %s as %s', (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it.each(['schema.prisma', 'migrations/001.sql', 'logo.png', 'Dockerfile', '.gitignore', 'a.d/b'])(
    'has no grammar for %s',
    (path) => {
      expect(languageOf(path)).toBeNull();
    },
  );
});

describe('limitationOf', () => {
  it('marks MDX as read without its components', () => {
    expect(limitationOf('blog/Launch.MDX')).toBe('mdx-components');
  });

  it.each(['README.md', 'app/page.tsx', 'schema.prisma', 'Dockerfile'])(
    'has nothing to say about %s',
    (path) => {
      expect(limitationOf(path)).toBeNull();
    },
  );
});

describe('loadGrammars', () => {
  it('loads every grammar and parses a sample of each without errors', async () => {
    const grammars = await loadGrammars();
    expect([...grammars.keys()].sort()).toEqual(Object.keys(GRAMMAR_FILES).sort());
    const parser = new Parser();
    try {
      for (const [id, sample] of Object.entries(samples) as [
        LanguageId,
        (typeof samples)[LanguageId],
      ][]) {
        parser.setLanguage(grammars.get(id) ?? null);
        const tree = parser.parse(sample.text);
        expect(tree, id).not.toBeNull();
        expect(tree?.rootNode.type, id).toBe(sample.root);
        expect(tree?.rootNode.hasError, id).toBe(false);
        tree?.delete();
      }
    } finally {
      parser.delete();
    }
  });

  it('loads them once per process', () => {
    expect(loadGrammars()).toBe(loadGrammars());
  });
});

describe('our Markdown build', () => {
  // The committed .wasm files are what tools/grammars/build-markdown.sh produced; its --check mode
  // rebuilds and compares the same checksums.
  it('matches the recorded checksums', () => {
    const recorded = readFileSync(
      fileURLToPath(new URL('../grammars/markdown.sha256', import.meta.url)),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/));
    expect(recorded).toHaveLength(2);
    for (const [sha256, file] of recorded) {
      const bytes = readFileSync(
        fileURLToPath(new URL(`../grammars/${file ?? ''}`, import.meta.url)),
      );
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(sha256);
    }
  });
});
