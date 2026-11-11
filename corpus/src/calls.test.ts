import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCalls, difference, type AnsweredEntry, type CallsLabel } from './calls.ts';

const label: CallsLabel = {
  name: 'createPoll',
  case: 'test',
  path: 'src/poll.ts',
  line: 3,
  column: 14,
  callers: [
    { name: 'route.ts (top level)', relation: 'calls', path: 'a/route.ts', lines: [4, 9] },
    { name: 'route.ts (top level)', relation: 'calls', path: 'b/route.ts', lines: [7] },
  ],
  callees: [
    {
      name: 'save',
      relation: 'calls',
      provenance: 'resolved',
      builtIn: false,
      place: 'src/db.ts:2',
      lines: [5],
    },
    {
      name: 'some',
      relation: 'calls',
      provenance: 'resolved',
      builtIn: true,
      place: null,
      lines: [4],
    },
    {
      name: 'tx.poll.create',
      relation: 'calls',
      provenance: 'unresolved',
      builtIn: false,
      place: null,
      lines: [6],
    },
  ],
};

const entry = (name: string, extra: Partial<AnsweredEntry>): AnsweredEntry => ({
  name,
  relation: 'calls',
  provenance: 'resolved',
  builtIn: false,
  place: null,
  sites: [],
  ...extra,
});
const at = (path: string, ...lines: number[]) => lines.map((line) => ({ path, line }));

const routeB = entry('route.ts (top level)', { sites: at('b/route.ts', 7) });
const routeA = entry('route.ts (top level)', { sites: at('a/route.ts', 9, 4) });
const some = entry('some', { builtIn: true, sites: at('src/poll.ts', 4) });
const save = entry('save', { place: { path: 'src/db.ts', line: 2 }, sites: at('src/poll.ts', 5) });
const create = entry('tx.poll.create', { provenance: 'unresolved', sites: at('src/poll.ts', 6) });
const callers = [routeB, routeA];
const callees = [create, some, save];

describe('compareCalls', () => {
  it('matches an answer equal to the labels, in any order, two callers sharing a name', () => {
    expect(compareCalls(label, callers, callees)).toEqual({
      callers: { missing: [], extra: [] },
      callees: { missing: [], extra: [] },
    });
  });

  it('says what differs: a caller missing a line, a callee guessed, a callee extra', () => {
    const result = compareCalls(
      label,
      [routeB, entry('route.ts (top level)', { sites: at('a/route.ts', 4) })],
      [
        // Drawn as resolved when it isn't: a difference, never accepted.
        entry('tx.poll.create', { sites: at('src/poll.ts', 6) }),
        some,
        save,
        entry('Math.max', { builtIn: true, sites: at('src/poll.ts', 8) }),
      ],
    );
    expect(result.callers).toEqual({
      missing: ['calls route.ts (top level) @ a/route.ts:4,9'],
      extra: ['calls route.ts (top level) @ a/route.ts:4'],
    });
    expect(result.callees).toEqual({
      missing: ['unresolved calls tx.poll.create -> - @ 6'],
      extra: [
        'resolved calls Math.max (built-in) -> - @ 8',
        'resolved calls tx.poll.create -> - @ 6',
      ],
    });
  });

  it('sees a call listed twice', () => {
    const twice = entry('save', {
      place: { path: 'src/db.ts', line: 2 },
      sites: at('src/poll.ts', 5, 5),
    });
    expect(compareCalls(label, callers, [create, some, twice]).callees).toEqual({
      missing: ['resolved calls save -> src/db.ts:2 @ 5'],
      extra: ['resolved calls save -> src/db.ts:2 @ 5,5'],
    });
  });

  it('counts duplicates: one answer line meets one label line', () => {
    expect(difference(['a', 'a'], ['a'])).toEqual({ missing: ['a'], extra: [] });
    expect(difference(['a'], ['a', 'a'])).toEqual({ missing: [], extra: ['a'] });
  });
});

describe('labels/calls.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('../labels/calls.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

  it('has the 20 functions of the Done when: 10 in Rallly, 10 in Documenso, none in packages/ee', () => {
    for (const repo of ['rallly', 'documenso']) {
      const labels = file[repo] as CallsLabel[];
      expect(labels).toHaveLength(10);
      for (const l of labels) {
        expect(l.path.startsWith('packages/ee/')).toBe(false);
        expect(l.case.length).toBeGreaterThan(0);
        expect(l.line).toBeGreaterThan(0);
        expect(l.column).toBeGreaterThan(0);
      }
    }
  });

  it('labels every caller and callee with lines, and places as path:line', () => {
    for (const repo of ['rallly', 'documenso']) {
      for (const l of file[repo] as CallsLabel[]) {
        expect(l.callers.length + l.callees.length).toBeGreaterThan(0);
        for (const c of [...l.callers, ...l.callees]) {
          expect(c.lines.length).toBeGreaterThan(0);
          expect(['calls', 'renders']).toContain(c.relation);
        }
        for (const c of l.callees) {
          expect(['resolved', 'unresolved']).toContain(c.provenance);
          if (c.provenance === 'unresolved' || c.builtIn) expect(c.place).toBeNull();
          else expect(c.place).toMatch(/^[^:]+:\d+$/);
        }
      }
    }
  });
});
