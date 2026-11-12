// The semantic service on a small monorepo shaped like the corpus forks (no node_modules): a shared config package,
// a ui package with exports and a barrel, a web app with its own alias, an extends to an npm config that isn't
// installed, an import from a package that isn't either, a dynamic call, a class method and a built-in call.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateGraph } from '@flowcanvas/graph-model';
import type { GraphPass } from './graph.js';
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
  // Found by phase 6's spike: LibreChat's whole Express backend (CommonJS, plain JavaScript) is in no tsconfig.json.
  it('sees files no tsconfig includes, through an inferred program (CommonJS JavaScript)', () => {
    const backend: Record<string, string> = {
      'apps/api/package.json': JSON.stringify({ name: '@fx/api' }),
      'apps/api/lib/format.js':
        'function slug(text) {\n  return text.trim();\n}\nmodule.exports = { slug };\n',
      'apps/api/server.js': [
        "const { slug } = require('./lib/format');",
        'function handle(req) {',
        '  return slug(req.title);',
        '}',
        'module.exports = { handle };',
        '',
      ].join('\n'),
    };
    for (const [path, content] of Object.entries(backend)) write(path, content);
    service.changed(Object.keys(backend), [...Object.keys(FILES), ...Object.keys(backend)]);
    // From handle, the call reaches slug through require and module.exports: resolved, with its place.
    const callees = service.callees('apps/api/server.js', 2, 10);
    expect(callees.target).toMatchObject({ name: 'handle', kind: 'function' });
    expect(callees.entries).toEqual([
      expect.objectContaining({
        name: 'slug',
        provenance: 'resolved',
        place: { path: 'apps/api/lib/format.js', line: 1, column: 10 },
        sites: [{ path: 'apps/api/server.js', line: 3, column: 10 }],
      }),
    ]);
    // TypeScript's references stop at `module.exports = { slug }`, so its call hierarchy finds no caller here: a
    // TypeScript limit for CommonJS shorthand exports (ADR 0027). The graph's edges, built forwards, have it.
    expect(service.callers('apps/api/lib/format.js', 1, 10).entries).toEqual([]);
  });

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

  it('names a caller outside any named function by its file, at top level (owner)', () => {
    write(
      'apps/web/src/boot.ts',
      "import { formatTitle } from './lib/format';\nexport const BOOT = formatTitle('go');\n",
    );
    service.changed(['apps/web/src/boot.ts'], [...Object.keys(FILES), 'apps/web/src/boot.ts']);
    const result = service.callers('apps/web/src/lib/format.ts', 1, 17);
    expect(result.entries.find((e) => e.place?.path === 'apps/web/src/boot.ts')).toMatchObject({
      name: 'boot.ts (top level)',
      kind: null,
      sites: [{ path: 'apps/web/src/boot.ts', line: 2, column: 21 }],
    });
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

  // Found by the corpus check (phase 5 step 6): a constant arrow scanned its whole file, built-in overloads listed
  // twice, calls to a constant or a built-in variable left out, and an unresolved name the size of its arguments.
  it('lists a constant arrow’s own calls once each, constants and built-in variables included', () => {
    const jobs = 'apps/web/src/jobs.ts';
    write(
      jobs,
      [
        "import { customAlphabet } from 'nanoid';",
        "import { z } from 'zod';",
        "export const makeId = customAlphabet('ab', 4);",
        'export interface Runner { start: () => void }',
        'export const runJob = async (input: string, done: () => void, runner: Runner) => {',
        '  const id = makeId();',
        '  done();',
        '  runner.start();',
        "  const parts = input.split(',').concat(input.split(';'));",
        '  const size = (() => parts.length)();',
        '  if (!Boolean(size)) throw new Error(id);',
        '  z.object({ a: z.string() }).parse(input);',
        '  const later = () => z.number();',
        '  setTimeout(() => huge(), 1);',
        '  return later;',
        '};',
        'export function after() {',
        '  return z.boolean();',
        '}',
        "import { huge } from './huge';",
        '',
      ].join('\n'),
    );
    // A project file over 1 MB isn't read (a generated bundle): a call into it stays unresolved. TypeScript's own
    // lib.dom.d.ts is larger still, and is read: setTimeout is a built-in (found by the corpus check).
    const huge = 'apps/web/src/huge.ts';
    write(huge, `export function huge() {}\n/*${' '.repeat(1024 * 1024)}*/\n`);
    service.changed([jobs, huge], [...Object.keys(FILES), jobs, huge]);
    const result = service.callees(jobs, 5, 14);
    expect(result.target?.name).toBe('runJob');
    expect(brief(result.entries)).toEqual([
      'resolved calls Boolean',
      'resolved calls Error',
      'resolved calls concat',
      'resolved calls makeId',
      'resolved calls setTimeout',
      'resolved calls split',
      'resolved calls start',
      // A parameter holds whatever it's given: the compiler can't say which function runs.
      'unresolved calls done',
      'unresolved calls huge',
      'unresolved calls z.object',
      'unresolved calls z.object(…).parse',
      'unresolved calls z.string',
    ]);
    // A constant holding a function: the project's, at its declaration.
    expect(result.entries.find((e) => e.name === 'makeId')).toMatchObject({
      builtIn: false,
      place: { path: jobs, line: 3, column: 14 },
    });
    // A member of an interface: fixed by the type, at its declaration.
    expect(result.entries.find((e) => e.name === 'start')).toMatchObject({
      kind: 'method',
      container: 'Runner',
      place: { path: jobs, line: 4, column: 27 },
    });
    expect(result.entries.find((e) => e.name === 'Error')).toMatchObject({
      builtIn: true,
      place: null,
    });
    // Both splits, one row; and no call counted twice.
    expect(result.entries.find((e) => e.name === 'split')?.sites).toHaveLength(2);
    for (const entry of result.entries) {
      const sites = entry.sites.map((s) => `${String(s.line)}:${String(s.column)}`);
      expect(new Set(sites).size).toBe(sites.length);
    }
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

describe('graph (phase 6)', () => {
  const now = () => Promise.resolve();
  const lines = (pass: GraphPass) =>
    pass.graph.edges
      .map(
        (e) =>
          `${e.from} -${e.relation ?? e.kind}-> ${e.to ?? `? ${e.target ?? ''}`} [${e.provenance}] @${e.lines.join(',')}`,
      )
      .sort();

  it('builds every code unit and call, resolved or unknown, built-ins counted apart', async () => {
    const pass = await service.graph(now);
    if (pass === null) throw new Error('no pass');
    expect(validateGraph(pass.graph)).toEqual([]);
    expect(pass.graph.nodes.map((n) => `${n.id} (${n.unit ?? ''})`).sort()).toEqual([
      'apps/web/src/lib/format.ts#formatTitle (function)',
      'apps/web/src/page.tsx#Page (component)',
      'apps/web/src/store.ts#Store (class)',
      'apps/web/src/store.ts#Store.save (method)',
      'apps/web/src/store.ts#useStore (function)',
      'packages/ui/src/button.tsx#Button (component)',
    ]);
    expect(lines(pass)).toEqual([
      'apps/web/src/page.tsx#Page -calls-> ? (save as () => void) [unknown] @10',
      'apps/web/src/page.tsx#Page -calls-> ? z.string [unknown] @8',
      'apps/web/src/page.tsx#Page -calls-> apps/web/src/lib/format.ts#formatTitle [resolved] @7',
      // <Button /> and <Again />: the same component under two names, one edge.
      'apps/web/src/page.tsx#Page -renders-> packages/ui/src/button.tsx#Button [resolved] @12',
      'apps/web/src/store.ts#Store.save -calls-> apps/web/src/lib/format.ts#formatTitle [resolved] @4',
      'apps/web/src/store.ts#useStore -calls-> apps/web/src/store.ts#Store [resolved] @8',
      'apps/web/src/store.ts#useStore -calls-> apps/web/src/store.ts#Store.save [resolved] @8',
    ]);
    // title.trim() and Math.max(): built-ins, counted, not edges (owner, 12 Nov 2026).
    expect(pass).toMatchObject({ builtInCalls: 2, complete: true, note: null });
    // The .env file is never read, so never walked.
    expect(pass.files).toBe(5);
  });

  it('after an edit, walks the changed file and those that call into it', async () => {
    await service.graph(now);
    write(
      'apps/web/src/lib/format.ts',
      'export function formatHeading(title: string): string {\n  return title.trim();\n}\n',
    );
    service.changed(['apps/web/src/lib/format.ts']);
    const pass = await service.graph(now);
    if (pass === null) throw new Error('no pass');
    expect(validateGraph(pass.graph)).toEqual([]);
    const ids = pass.graph.nodes.map((n) => n.id);
    expect(ids).toContain('apps/web/src/lib/format.ts#formatHeading');
    expect(ids).not.toContain('apps/web/src/lib/format.ts#formatTitle');
    // Its callers were walked again: their calls to the old name no longer reach anything.
    expect(lines(pass).filter((line) => line.includes('formatTitle'))).toEqual([
      'apps/web/src/page.tsx#Page -calls-> ? formatTitle [unknown] @7',
      'apps/web/src/store.ts#Store.save -calls-> ? formatTitle [unknown] @4',
    ]);
  });

  // Holding every program until memory ran high took Twenty past the worker's cap (phase 6 step 3).
  it('releases the programs it built, and keeps the ones questions use', async () => {
    await service.graph(now);
    expect(service.liveServices).toBe(0);
    service.callers('apps/web/src/lib/format.ts', 1, 17);
    const warm = service.liveServices;
    expect(warm).toBeGreaterThan(0);
    service.changed(['apps/web/src/page.tsx']);
    await service.graph(now);
    expect(service.liveServices).toBe(warm);
  });

  it('starts again when the project’s structure changes while it runs', async () => {
    let paused = 0;
    const pass = await service.graph(() => {
      paused += 1;
      if (paused === 1) service.changed(['apps/web/tsconfig.json']);
      return Promise.resolve();
    }, 1);
    expect(pass).toBeNull();
    const again = await service.graph(now);
    expect(again?.files).toBe(5);
  });
});
