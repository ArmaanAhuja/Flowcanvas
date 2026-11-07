import { describe, expect, it } from 'vitest';
import { detectIndent, languageFor } from './languages';

describe('languageFor', () => {
  it('names what a web project has, and plain text for the rest', () => {
    expect(
      [
        'a.ts',
        'b.tsx',
        'c.mjs',
        'd.JSX',
        'package.json',
        'x.css',
        'index.html',
        'README.md',
        'Dockerfile',
        '.gitignore',
        'a.py',
      ].map((path) => languageFor(`src/${path}`).name),
    ).toEqual([
      'TypeScript',
      'TypeScript JSX',
      'JavaScript',
      'JavaScript JSX',
      'JSON',
      'CSS',
      'HTML',
      'Markdown',
      'Plain text',
      'Plain text',
      'Plain text',
    ]);
  });
});

describe('detectIndent', () => {
  it('finds two spaces, four spaces or tabs, and assumes two for files without indentation', () => {
    expect(detectIndent('a\n  b\n    c\n  d\n').label).toBe('Spaces: 2');
    expect(detectIndent('a\n    b\n        c\n    d\n').label).toBe('Spaces: 4');
    expect(detectIndent('a\n\tb\n\t\tc\n')).toEqual({ unit: '\t', label: 'Tabs' });
    expect(detectIndent('no indentation\nat all\n')).toEqual({ unit: '  ', label: 'Spaces: 2' });
  });
});
