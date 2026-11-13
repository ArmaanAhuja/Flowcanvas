import { describe, expect, it } from 'vitest';
import {
  buildSteps,
  commentsOf,
  countsIn,
  pathsNamed,
  phasesFromStatus,
  phasesNamed,
  runAndFeatures,
  stillToCome,
  updatedDate,
  withCounts,
} from './checks.js';

const STATUS = [
  '| Phase | Name | Status | Build | Notes |',
  '| --- | --- | --- | --- | --- |',
  '| 1 | Skeleton | accepted | `0.1.0` | |',
  '| 1d | Sandbox | in review | `0.5.0` | |',
  '| 6 | Graph model | accepted | `0.10.0` | |',
  '| 7 | Flow builder | in progress | — | |',
].join('\n');

describe('phases', () => {
  it('reads accepted and in-progress phases from STATUS.md', () => {
    expect(phasesFromStatus(STATUS)).toEqual({ accepted: ['1', '6'], inProgress: ['7'] });
  });

  it('finds every phase a text names, lists included', () => {
    expect(phasesNamed('phases 4, 5 and 6; phase 48a; Phase 7')).toEqual([
      '4',
      '5',
      '6',
      '48a',
      '7',
    ]);
  });
});

describe('stillToCome', () => {
  const accepted = new Set(['2', '4', '6']);
  it('finds an accepted phase said to be still to come', () => {
    expect(stillToCome('Entry points arrive in phase 6.', accepted, 'a.md')).toHaveLength(1);
    expect(
      stillToCome('A stand-in until the phase 2 start screen.', accepted, 'a.md'),
    ).toHaveLength(1);
    // Found by hand in ARCHITECTURE.md after the first sweep.
    expect(
      stillToCome('the projects list (a stand-in for the phase 2 start screen)', accepted, 'a.md'),
    ).toHaveLength(1);
    expect(
      stillToCome('Sequence and graph arrive in phases 13 and 4', accepted, 'a.md'),
    ).toHaveLength(1);
  });

  it('leaves alone phases that aren’t accepted, and phases named beside, not in, the phrase', () => {
    expect(stillToCome('Expanding a flow arrives in phase 12.', accepted, 'a.md')).toEqual([]);
    // Found by the first sweep: "search (phase 4)" sits beside "arrives in phase 13", not in it.
    expect(
      stillToCome(
        'the view switch (Sequence arrives in phase 13), search (phase 4), status',
        accepted,
        'a.md',
      ),
    ).toEqual([]);
    expect(stillToCome('Built in phase 6, accepted.', accepted, 'a.md')).toEqual([]);
  });
});

describe('commentsOf', () => {
  it('reads line and block comments with their line, not slashes in strings', () => {
    const source = [
      "const url = 'https://example.com';",
      '// one',
      '/* two',
      '   lines */',
      'f(); // three',
    ].join('\n');
    expect(commentsOf(source).map((c) => [c.text.slice(0, 6), c.line])).toEqual([
      ['// one', 2],
      ['/* two', 3],
      ['// thr', 5],
    ]);
  });
});

describe('runAndFeatures', () => {
  const facts = {
    version: '0.10.0',
    changelog: '# Changelog\n\n## 0.10.0 · 12 Nov 2026\n',
    accepted: ['1', '6'],
    inProgress: ['7'],
  };
  const doc = (lines: Record<string, string> = {}) =>
    [
      `- **Last updated:** ${lines.updated ?? '13 Nov 2026: phase 7, step 6'}`,
      `- **Released (on staging):** \`${lines.released ?? '0.10.0'}\`, phase 6`,
      `- **Progress:** phases ${lines.progress ?? '1 and 6'} are accepted; 7 is in progress.`,
      '### The graph model (phase 6, accepted, 0.10.0)',
      '### Coming next',
      `- ${lines.next ?? 'Phase 8: entry points.'}`,
    ].join('\n');

  it('agrees with a doc that’s current', () => {
    expect(runAndFeatures(doc(), facts)).toEqual([]);
  });

  it('finds an old release, an old progress line, an old date, and an accepted phase still "next"', () => {
    const problems = runAndFeatures(
      doc({
        released: '0.7.0',
        progress: '1',
        updated: '8 Nov 2026: phase 3 accepted',
        next: 'Phase 6: the graph.',
      }),
      facts,
    ).map((f) => f.problem);
    expect(problems).toEqual([
      'says 0.7.0 is released; package.json says 0.10.0',
      'lists the accepted phases as 1; STATUS.md says 1, 6',
      "doesn't name phase 7, where the work is: 8 Nov 2026: phase 3 accepted",
      "lists phase 6 as coming next, but it's accepted",
    ]);
  });

  it('finds a release with no CHANGELOG section, and an accepted phase with no section saying so', () => {
    const problems = runAndFeatures(doc().replace('(phase 6, accepted, 0.10.0)', '(phase 6)'), {
      ...facts,
      changelog: '# Changelog\n',
    }).map((f) => f.problem);
    expect(problems).toEqual([
      'has no section for 0.10.0',
      'has no section saying phase 6 is accepted',
    ]);
  });
});

describe('buildSteps', () => {
  it('finds a step still to do in an accepted phase, and leaves the phase in progress alone', () => {
    const doc = [
      '## Phase 6 — Graph model',
      '| 5 | UI | B | done |',
      '| 6 | Proof | B | *next* |',
      '## Phase 7 — Flow builder',
      '| 7 | Proof | B | *planned* |',
    ].join('\n');
    expect(buildSteps(doc, new Set(['6'])).map((f) => f.where)).toEqual(['docs/build-steps.md:3']);
  });
});

describe('pathsNamed', () => {
  it('finds our paths, not patterns, placeholders, or a corpus project’s', () => {
    const doc = [
      'See `apps/web/src/flow/` and `docs/STATUS.md:12`.',
      'Globs like `packages/*/src` and `apps/<name>` are not paths.',
      'In Rallly, open `apps/web/src/features/poll/mutations.ts`.',
    ].join('\n');
    expect(pathsNamed(doc)).toEqual([
      { path: 'apps/web/src/flow/', line: 1 },
      { path: 'docs/STATUS.md', line: 1 },
    ]);
  });
});

describe('counts', () => {
  it('reads and rewrites the counts between their markers', () => {
    const doc =
      '| <!-- count:unit -->1,057<!-- /count --> unit tests | <!-- count:docker -->53<!-- /count --> |';
    expect(countsIn(doc)).toEqual(
      new Map([
        ['unit', '1,057'],
        ['docker', '53'],
      ]),
    );
    expect(withCounts(doc, new Map([['unit', 1084]]))).toBe(
      '| <!-- count:unit -->1,084<!-- /count --> unit tests | <!-- count:docker -->53<!-- /count --> |',
    );
  });
});

describe('updatedDate', () => {
  const doc = '- **Last updated:** 8 Nov 2026: phase 3 accepted';
  it('finds a "Last updated" days behind the latest commit, and allows the docs a couple of days', () => {
    expect(updatedDate(doc, new Date('2026-11-13T21:00:00Z'))[0]?.problem).toBe(
      'was last updated on 8 Nov 2026, 5 days before the latest commit',
    );
    expect(updatedDate(doc, new Date('2026-11-10T21:00:00Z'))).toEqual([]);
    expect(updatedDate('- **Last updated:** recently', new Date())).toHaveLength(1);
  });
});
