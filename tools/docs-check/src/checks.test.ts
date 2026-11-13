import { describe, expect, it } from 'vitest';
import {
  STEP_FIELDS,
  architectureDependencies,
  architectureParts,
  buildSteps,
  commentsOf,
  countsIn,
  currentMilestone,
  danglingReferences,
  pathsNamed,
  phasesFromStatus,
  phasesNamed,
  reviewed,
  runAndFeatures,
  stamps,
  stepEntries,
  stillToCome,
  undocumentedCommits,
  unreleasedVersion,
  updatedDate,
  upgradeTriggers,
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
    expect(phasesFromStatus(STATUS)).toEqual({
      accepted: ['1', '6'],
      inProgress: ['7'],
      current: ['7'],
    });
    // In review, the phase is still where the work is; 1d, in review earlier in the table, isn't.
    expect(phasesFromStatus(STATUS.replace('in progress', 'in review')).current).toEqual(['7']);
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

describe('stamps', () => {
  it('finds a text dated to a phase the work has moved past (ARCHITECTURE said phase 1b during phase 7)', () => {
    const doc =
      'The system as it is **today** (end of phase 1b). Kept current at the end of every phase.';
    expect(stamps(doc, ['7'], 'ARCHITECTURE.md').map((f) => f.problem)).toEqual([
      'is dated phase 1b; the work is at phase 7: today** (end of phase 1b)',
    ]);
    expect(stamps('Accurate as of phase 6.', ['7'], 'a.md')).toHaveLength(1);
    expect(stamps('Built (end of phase 3) and kept.', ['7'], 'a.md')).toHaveLength(1);
  });

  it('accepts the current phase, and lines that date nothing', () => {
    expect(stamps('As it is **today** (phase 7, in progress).', ['7'], 'a.md')).toEqual([]);
    expect(stamps('Kept current at the end of every phase.', ['7'], 'a.md')).toEqual([]);
    expect(stamps('Open today (13 Nov 2026).', ['7'], 'a.md')).toEqual([]);
  });
});

describe('architectureParts', () => {
  const doc = [
    '| Package | Folder | Runs in | Today |',
    '| `@flowcanvas/web` | `apps/web` | Browser | The canvas (`src/canvas/`) and the flows (`src/flow/`) |',
  ].join('\n');

  it('finds a source folder its package’s row doesn’t name, and a package with no row', () => {
    expect(
      architectureParts(doc, [
        { name: '@flowcanvas/web', folders: ['canvas', 'flow', 'usage'] },
        { name: '@flowcanvas/ui', folders: [] },
      ]).map((f) => f.problem),
    ).toEqual([
      "@flowcanvas/web's row doesn't say what src/usage/ is",
      'has no row for @flowcanvas/ui in its parts table',
    ]);
  });

  it('agrees when every folder is named in its own row', () => {
    expect(
      architectureParts(doc, [{ name: '@flowcanvas/web', folders: ['canvas', 'flow'] }]),
    ).toEqual([]);
  });
});

describe('architectureDependencies', () => {
  const doc = [
    'Dependencies between packages:',
    '- `web → ui, graph-model`',
    '- `ui → tokens` (styles only)',
    '',
  ].join('\n');

  it('agrees with the package.json files', () => {
    const real = new Map([
      ['web', ['graph-model', 'ui']],
      ['ui', ['tokens']],
    ]);
    expect(architectureDependencies(doc, real)).toEqual([]);
  });

  it('finds a dependency missing from the list, one listed that isn’t there, and a package left out', () => {
    const real = new Map([
      ['web', ['graph-model', 'ui', 'engine']],
      ['engine', ['graph-model']],
    ]);
    expect(architectureDependencies(doc, real).map((f) => f.problem)).toEqual([
      'lists web → graph-model, ui; its package.json says engine, graph-model, ui',
      'lists ui → tokens; its package.json says nothing',
      'lists engine → nothing; its package.json says graph-model',
    ]);
  });
});

describe('the milestone gate', () => {
  it('reads the current milestone and holds each living doc’s Reviewed line to it', () => {
    const milestone = currentMilestone('# Status\n\n**Current milestone:** phase 7, milestone B\n');
    expect(milestone).toBe('phase 7, milestone B');
    expect(
      reviewed('**Reviewed:** phase 7, milestone B (13 Nov 2026)', 'phase 7, milestone B', 'a.md'),
    ).toEqual([]);
    expect(
      reviewed('**Reviewed:** phase 7, milestone A', 'phase 7, milestone B', 'a.md'),
    ).toHaveLength(1);
    expect(reviewed('No line.', 'phase 7, milestone B', 'a.md')[0]?.problem).toBe(
      'has no **Reviewed:** line',
    );
  });

  it('finds a step entry missing a field of the template, in the phase asked about only', () => {
    const full = STEP_FIELDS.map((field) =>
      field === 'Risks' ? '**Risks and laptop:** x' : `**${field}:** x`,
    ).join('\n');
    const doc = [
      '### Step 7.1 — Done properly',
      full,
      '### Step 7.2 — No tests written up',
      full.replace('**Tests:** x', ''),
      '### Step 7.3 — Its laptop not said',
      full.replace('**Risks and laptop:** x', '**Risks:** x'),
      '### Step 6.9 — Another phase',
      'nothing',
    ].join('\n');
    expect(stepEntries(doc, '7').map((f) => f.problem)).toEqual([
      "step 7.2's entry has no Tests",
      "step 7.3's entry has no Laptop",
    ]);
  });

  it('finds a commit no step names, and lets the commits that only write docs off', () => {
    const doc = 'Commits: `c59edae` the fix.';
    expect(
      undocumentedCommits(doc, [
        { sha: 'c59edae1234', subject: 'fix(engine): …', docsOnly: false },
        { sha: 'f8b0221abcd', subject: 'ci: deploy …', docsOnly: false },
        { sha: 'ee7a59b0000', subject: 'docs: step 7.7', docsOnly: true },
      ]).map((f) => f.problem),
    ).toEqual(["doesn't name commit f8b0221 (ci: deploy …)"]);
  });
});

describe('upgrade-later and references', () => {
  it('finds a trigger naming an accepted phase that doesn’t say what happened', () => {
    const doc = [
      '| 24 | **Profile pictures** | Names only. | Avatars. | The phase 2 app shell’s avatar menu. | 31 Oct |',
      '| 3 | **TS 7** | 6.0. | 7. | Stable API. **Checked 12 Nov 2026 (before phase 5):** not yet. | 26 Oct |',
      '| 9 | **Visibility** | Public. | Private. | Before design partners (phase 45). | 26 Oct |',
    ].join('\n');
    expect(upgradeTriggers(doc, new Set(['2', '5'])).map((f) => f.where)).toEqual([
      'docs/upgrade-later.md:1',
    ]);
  });

  it('finds an upgrade-later item or an ADR that doesn’t exist', () => {
    const known = { items: new Set(['10', '33']), adrs: new Set(['0028']) };
    const text = 'See upgrade-later 33 and upgrade-later item 99; ADR 0028 and ADR 0031.';
    expect(danglingReferences(text, known, 'a.md').map((f) => f.problem)).toEqual([
      "names upgrade-later 99, which isn't an item or in its removed list",
      "names ADR 0031, which doesn't exist",
    ]);
  });
});

describe('unreleasedVersion', () => {
  it('lets package.json run ahead of staging only for a phase still in review or in progress', () => {
    const status = (state: string) =>
      `| 7 | Flow builder | ${state} | \`0.11.0\` | PR #21 |\n| 6 | Graph model | accepted | \`0.10.0\` | |`;
    expect(unreleasedVersion(status('in review'), '0.11.0')).toBe(true);
    expect(unreleasedVersion(status('accepted'), '0.11.0')).toBe(false);
    expect(unreleasedVersion(status('in review'), '0.12.0')).toBe(false);
  });
});
