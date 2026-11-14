import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  barProblems,
  compareEntryPoints,
  inScope,
  recall,
  type AnsweredEntryPoint,
  type ForkLabels,
} from './entry-points.js';

const labels: ForkLabels = {
  scope: {
    screen: ['*'],
    'api-route': ['*'],
    element: ['app/form.tsx'],
    exclude: ['packages/ee/'],
  },
  notes: [],
  entries: [
    { kind: 'screen', name: '/polls', file: 'app/polls/page.tsx', line: 3, group: 'convention' },
    { kind: 'api-route', name: 'GET /api/polls', file: 'server/app.ts', line: 9, group: 'code' },
    {
      kind: 'api-route',
      name: 'GET /api/oauth/auth/:id',
      file: 'lib/oauth.ts',
      line: 80,
      group: 'code',
    },
    { kind: 'element', name: '<button> onClick', file: 'app/form.tsx', line: 12, group: 'code' },
  ],
};
const at = (path: string, line: number) => ({ path, line });
const answered: AnsweredEntryPoint[] = [
  { kind: 'screen', name: '/polls', place: at('app/polls/page.tsx', 3), complete: true, why: null },
  {
    kind: 'api-route',
    name: 'GET /api/polls',
    place: at('server/app.ts', 9),
    complete: true,
    why: null,
  },
  {
    kind: 'api-route',
    name: 'GET /:unknown/auth/:id',
    place: at('lib/oauth.ts', 80),
    complete: false,
    why: 'Part of its path isn’t a constant the code fixes.',
  },
  {
    kind: 'element',
    name: '<button> onClick',
    place: at('app/form.tsx', 12),
    complete: true,
    why: null,
  },
  // Out of scope: an element in a file not labelled, and the enterprise folder.
  {
    kind: 'element',
    name: '<a> onClick',
    place: at('app/other.tsx', 4),
    complete: true,
    why: null,
  },
  {
    kind: 'api-route',
    name: 'GET /api/csc',
    place: at('packages/ee/csc.ts', 2),
    complete: true,
    why: null,
  },
];

describe('compareEntryPoints', () => {
  it('counts each label found, or not fully detected at its place with why, within the labelled scope only', () => {
    const result = compareEntryPoints(labels, answered);
    expect(result.groups.convention).toEqual({ labelled: 1, found: 1, incomplete: [], missed: [] });
    expect(result.groups.code.found).toBe(2);
    expect(result.groups.code.incomplete).toEqual([
      'api-route | GET /api/oauth/auth/:id | lib/oauth.ts:80: listed as GET /:unknown/auth/:id — Part of its path isn’t a constant the code fixes.',
    ]);
    expect(result.falseFinds).toEqual([]);
    expect(recall(result.groups.code)).toBeCloseTo(2 / 3);
  });

  it('names what the bar refuses: a missed convention entry point, recall under 95%, a false find', () => {
    const result = compareEntryPoints(labels, [
      ...answered.filter((e) => e.kind !== 'screen'),
      {
        kind: 'api-route',
        name: 'POST /api/polls',
        place: at('server/app.ts', 10),
        complete: true,
        why: null,
      },
    ]);
    expect(barProblems(result)).toEqual([
      'convention: 0 of 1 found',
      'code: 2 of 3 found, under 95%',
      'missed, unexplained: screen | /polls | app/polls/page.tsx:3',
      'false find: api-route | POST /api/polls | server/app.ts:10',
    ]);
  });

  it('reads a scope: everywhere, files and folders, and folders left out', () => {
    expect(inScope(labels.scope, 'element', 'app/form.tsx')).toBe(true);
    expect(inScope(labels.scope, 'element', 'app/form.tsx.bak')).toBe(false);
    expect(inScope(labels.scope, 'api-route', 'packages/ee/x.ts')).toBe(false);
    expect(inScope(labels.scope, 'cli-command', 'package.json')).toBe(false);
  });
});

describe('labels/entry-points.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('../labels/entry-points.json', import.meta.url), 'utf8'),
  ) as Record<string, ForkLabels | string>;

  it('labels the four forks, each entry in its scope and a group, none twice and none in packages/ee', () => {
    for (const fork of ['rallly', 'documenso', 'librechat', 'twenty']) {
      const labelled = file[fork] as ForkLabels;
      expect(labelled.entries.length).toBeGreaterThan(300);
      const keys = new Set<string>();
      for (const e of labelled.entries) {
        expect(inScope(labelled.scope, e.kind, e.file), `${fork} ${e.name}`).toBe(true);
        expect(['convention', 'code']).toContain(e.group);
        expect(e.file.startsWith('packages/ee/')).toBe(false);
        const key = `${e.kind} ${e.name} ${e.file}:${String(e.line)}`;
        expect(keys.has(key), key).toBe(false);
        keys.add(key);
      }
      // Both groups, and every kind the fork has.
      expect(new Set(labelled.entries.map((e) => e.group)).size).toBe(2);
      expect(labelled.entries.some((e) => e.kind === 'element')).toBe(true);
      expect(labelled.entries.some((e) => e.kind === 'cli-command')).toBe(true);
    }
    expect(typeof file.about).toBe('string');
  });
});
