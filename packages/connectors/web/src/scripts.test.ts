import { describe, expect, it } from 'vitest';
import { projectFile, scriptEntries } from './scripts.js';

const PACKAGE = [
  '{',
  '  "name": "@rallly/web",',
  '  "scripts": {',
  '    "dev": "next dev",',
  '    "seed": "NODE_ENV=dev tsx ./scripts/seed.ts --force",',
  '    "build": "pnpm i18n && next build"',
  '  },',
  '  "dependencies": { "dev": "1.0.0" }',
  '}',
].join('\n');

describe('scriptEntries', () => {
  it('lists each script by package and name, at its own line', () => {
    expect(scriptEntries(PACKAGE, '@rallly/web')).toEqual([
      {
        kind: 'cli-command',
        framework: 'package-json',
        name: '@rallly/web: dev',
        at: { line: 4, column: 5 },
        complete: true,
      },
      {
        kind: 'cli-command',
        framework: 'package-json',
        name: '@rallly/web: seed',
        at: { line: 5, column: 5 },
        complete: true,
        runs: 'scripts/seed.ts',
      },
      {
        kind: 'cli-command',
        framework: 'package-json',
        name: '@rallly/web: build',
        at: { line: 6, column: 5 },
        complete: true,
      },
    ]);
  });

  it('finds a script by its key, not a value with the same text', () => {
    const text = '{\n  "scripts": {\n    "start": "dev",\n    "dev": "next dev"\n  }\n}';
    expect(scriptEntries(text, 'x').map((e) => [e.name, e.at.line])).toEqual([
      ['x: start', 3],
      ['x: dev', 4],
    ]);
  });

  it('has nothing for a package without scripts, and refuses text that isn’t JSON', () => {
    expect(scriptEntries('{ "name": "x" }', 'x')).toEqual([]);
    expect(() => scriptEntries('{ nope', 'x')).toThrow();
  });
});

describe('projectFile', () => {
  it('finds the file a runner runs, past flags and earlier commands, and nothing for tools', () => {
    expect(projectFile('node dist/server.js')).toBe('dist/server.js');
    expect(projectFile('pnpm build && tsx watch --clear-screen=false src/main.ts')).toBe(
      'src/main.ts',
    );
    expect(projectFile('next build')).toBeNull();
    expect(projectFile('vitest run')).toBeNull();
    expect(projectFile('node --max-old-space-size=4096 ./node_modules/.bin/thing')).toBeNull();
  });
});
