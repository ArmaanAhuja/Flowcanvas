// The semantic service on a small monorepo shaped like the corpus forks (no node_modules): a shared config package,
// a ui package with exports and a barrel, a web app with its own alias, an extends to an npm config that isn't
// installed, an import from a package that isn't either, a dynamic call, a class method and a built-in call.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARTLY, SemanticService } from './semantic-service.js';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', private: true }),
  'packages/tsconfig/package.json': JSON.stringify({ name: '@fx/tsconfig' }),
  'packages/tsconfig/base.json': JSON.stringify({
    compilerOptions: { strict: true, jsx: 'react-jsx' },
  }),
  'packages/ui/package.json': JSON.stringify({
    name: '@fx/ui',
    exports: { '.': './src/index.ts', './*': './src/*.tsx' },
    devDependencies: { '@fx/tsconfig': 'workspace:*' },
  }),
  'packages/ui/tsconfig.json': JSON.stringify({
    extends: '@fx/tsconfig/base.json',
    include: ['src'],
  }),
  'packages/ui/src/button.tsx': 'export function Button() {\n  return <button />;\n}\n',
  'packages/ui/src/index.ts': "export { Button } from './button';\n",
  'apps/web/package.json': JSON.stringify({
    name: '@fx/web',
    dependencies: { '@fx/ui': 'workspace:*', zod: '^3.0.0' },
  }),
  // An npm config that isn't installed: its options are lost, and the analysis defaults fill in (jsx).
  'apps/web/tsconfig.json': JSON.stringify({
    extends: '@tsconfig/next/tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src'],
  }),
  'apps/web/src/lib/format.ts':
    'export function formatTitle(title: string): string {\n  return title.trim();\n}\n',
  'apps/web/src/page.tsx': [
    "import { Button } from '@fx/ui/button';",
    "import { Button as Again } from '@fx/ui';",
    "import { formatTitle } from '@/lib/format';",
    "import { z } from 'zod';",
    'declare const handlers: Record<string, unknown>;',
    'export function Page() {',
    "  const title = formatTitle(' x ');",
    '  z.string();',
    "  const save = handlers['save'];",
    '  (save as () => void)();',
    '  const most = Math.max(1, 2);',
    '  return <main><Button /><Again />{title}{most}<div /></main>;',
    '}',
    '',
  ].join('\n'),
  'apps/web/src/store.ts': [
    "import { formatTitle } from './lib/format';",
    'export class Store {',
    '  save(): string {',
    "    return formatTitle('a');",
    '  }',
    '}',
    'export function useStore(): string {',
    '  return new Store().save();',
    '}',
    '',
  ].join('\n'),
  'apps/web/.env': 'SECRET=canary-phase5\n',
};

let root: string;
let outside: string;
let service: SemanticService;

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-semantics-'));
  outside = mkdtempSync(join(tmpdir(), 'fc-outside-'));
  for (const [path, content] of Object.entries(FILES)) write(path, content);
  service = new SemanticService({ ts, root, files: Object.keys(FILES) });
});
afterEach(() => {
  service.dispose();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const brief = (entries: readonly { name: string; relation: string; provenance: string }[]) =>
  entries.map((e) => `${e.provenance} ${e.relation} ${e.name}`).sort();

describe('callers', () => {
  it('finds every caller across the app, through its alias and relative imports', () => {
    const result = service.callers('apps/web/src/lib/format.ts', 1, 17);
    expect(result.target).toMatchObject({
      name: 'formatTitle',
      kind: 'function',
      place: { path: 'apps/web/src/lib/format.ts', line: 1, column: 17 },
    });
    expect(brief(result.entries)).toEqual(['resolved calls Page', 'resolved calls save']);
    expect(result.entries.find((e) => e.name === 'Page')?.sites).toEqual([
      { path: 'apps/web/src/page.tsx', line: 7, column: 17 },
    ]);
    expect(result.entries.find((e) => e.name === 'save')).toMatchObject({
      kind: 'method',
      container: 'Store',
    });
    expect(result.complete).toBe(true);
  });

  it('finds who renders a component in another package, through exports and a barrel', () => {
    const result = service.callers('packages/ui/src/button.tsx', 1, 17);
    expect(result.target).toMatchObject({ name: 'Button', kind: 'component' });
    expect(brief(result.entries)).toEqual(['resolved renders Page']);
    // <Button /> and <Again />: two sites, both renders of the same Button.
    expect(result.entries[0]?.sites).toHaveLength(2);
  });

  it('works from a use of the function, not only its declaration', () => {
    const result = service.callers('apps/web/src/page.tsx', 7, 17);
    expect(result.target?.name).toBe('formatTitle');
    expect(result.entries).toHaveLength(2);
  });

  it('says so when there is nothing callable at the place', () => {
    const result = service.callers('apps/web/src/page.tsx', 5, 1);
    expect(result).toMatchObject({ target: null, entries: [] });
    expect(result.message).toMatch(/Put the cursor on a function/);
  });
});

describe('callees', () => {
  it('lists resolved calls and renders, built-ins, and what it could not resolve, never guessed', () => {
    const result = service.callees('apps/web/src/page.tsx', 6, 17);
    expect(result.target?.name).toBe('Page');
    expect(brief(result.entries)).toEqual([
      'resolved calls formatTitle',
      'resolved calls max',
      'resolved renders Button',
      'unresolved calls (save as () => void)',
      'unresolved calls z.string',
    ]);
    const formatTitle = result.entries.find((e) => e.name === 'formatTitle');
    expect(formatTitle).toMatchObject({
      builtIn: false,
      place: { path: 'apps/web/src/lib/format.ts', line: 1, column: 17 },
    });
    // Built in: resolved, but no place in the project.
    expect(result.entries.find((e) => e.name === 'max')).toMatchObject({
      builtIn: true,
      place: null,
    });
    // Unresolved: never a place to jump to.
    for (const entry of result.entries.filter((e) => e.provenance === 'unresolved')) {
      expect(entry.place).toBeNull();
      expect(entry.sites.length).toBeGreaterThan(0);
    }
    // <Button /> and <Again /> render the same component: one entry, two sites. <div /> isn't a call.
    expect(result.entries.find((e) => e.name === 'Button')?.sites).toHaveLength(2);
  });

  it('lists a method’s calls, and a constructor call', () => {
    const result = service.callees('apps/web/src/store.ts', 7, 17);
    expect(brief(result.entries)).toEqual(['resolved calls Store', 'resolved calls save']);
  });
});

describe('definition and references', () => {
  it('goes from a use to the definition in another file, through the alias', () => {
    expect(service.definition('apps/web/src/page.tsx', 7, 17)).toEqual({
      definitions: [
        {
          name: 'formatTitle',
          kind: 'function',
          container: null,
          place: { path: 'apps/web/src/lib/format.ts', line: 1, column: 17 },
          builtIn: false,
        },
      ],
      message: null,
    });
  });

  it('finds every reference, the definition marked', () => {
    const result = service.references('apps/web/src/lib/format.ts', 1, 17);
    expect(result.references.filter((r) => r.isDefinition).map((r) => r.path)).toEqual([
      'apps/web/src/lib/format.ts',
    ]);
    expect(new Set(result.references.map((r) => r.path))).toEqual(
      new Set(['apps/web/src/lib/format.ts', 'apps/web/src/page.tsx', 'apps/web/src/store.ts']),
    );
    expect(result.complete).toBe(true);
  });
});

describe('keeping up with changes', () => {
  it('finds a caller added in an edit, and forgets one removed', () => {
    write('apps/web/src/store.ts', 'export const nothing = 1;\n');
    write(
      'apps/web/src/extra.ts',
      "import { formatTitle } from './lib/format';\nexport function shout(): string {\n  return formatTitle('b');\n}\n",
    );
    service.changed(
      ['apps/web/src/store.ts', 'apps/web/src/extra.ts'],
      [...Object.keys(FILES), 'apps/web/src/extra.ts'],
    );
    expect(brief(service.callers('apps/web/src/lib/format.ts', 1, 17).entries)).toEqual([
      'resolved calls Page',
      'resolved calls shout',
    ]);
  });
});

describe('what the compiler may read', () => {
  it('never follows a link out of the project: a call through it stays unresolved', () => {
    writeFileSync(
      join(outside, 'leak.ts'),
      'export function leak(): string {\n  return "canary";\n}\n',
    );
    symlinkSync(join(outside, 'leak.ts'), join(root, 'apps/web/src/leak.ts'));
    write(
      'apps/web/src/uses-leak.ts',
      "import { leak } from './leak';\nexport function useLeak(): string {\n  return leak();\n}\n",
    );
    service.changed(
      ['apps/web/src/uses-leak.ts'],
      [...Object.keys(FILES), 'apps/web/src/leak.ts', 'apps/web/src/uses-leak.ts'],
    );
    const callees = service.callees('apps/web/src/uses-leak.ts', 2, 17);
    expect(brief(callees.entries)).toEqual(['unresolved calls leak']);
    // An import that doesn't resolve is its own definition: the import line, never the file behind the link.
    expect(
      service.definition('apps/web/src/uses-leak.ts', 3, 10).definitions.map((d) => d.place?.path),
    ).toEqual(['apps/web/src/uses-leak.ts']);
    const answers = JSON.stringify([
      callees,
      service.references('apps/web/src/uses-leak.ts', 3, 10),
    ]);
    expect(answers).not.toContain('canary');
    expect(answers).not.toContain(outside);
  });

  it('never reads a secret file, even one named like a module (CLAUDE.md rule 5)', () => {
    write(
      'apps/web/src/.env.ts',
      'export function secret(): string {\n  return "canary-env";\n}\n',
    );
    write(
      'apps/web/src/uses-secret.ts',
      "import { secret } from './.env';\nexport function useSecret(): string {\n  return secret();\n}\n",
    );
    service.changed(
      ['apps/web/src/uses-secret.ts'],
      [...Object.keys(FILES), 'apps/web/src/uses-secret.ts'],
    );
    const callees = service.callees('apps/web/src/uses-secret.ts', 2, 17);
    expect(brief(callees.entries)).toEqual(['unresolved calls secret']);
    expect(JSON.stringify(callees)).not.toContain('canary-env');
    expect(
      service
        .definition('apps/web/src/uses-secret.ts', 3, 10)
        .definitions.map((d) => d.place?.path),
    ).toEqual(['apps/web/src/uses-secret.ts']);
  });
});

describe('memory', () => {
  it('releases language services when the heap is high, and says the answer may be partial', async () => {
    const { heap } = await import('./v8.js');
    service.callers('apps/web/src/lib/format.ts', 1, 17);
    vi.spyOn(heap, 'read').mockReturnValue({ used: 95, limit: 100 });
    const result = service.callers('packages/ui/src/button.tsx', 1, 17);
    expect(result.complete).toBe(false);
    expect(result.message).toBe(PARTLY.memory);
  });
});
