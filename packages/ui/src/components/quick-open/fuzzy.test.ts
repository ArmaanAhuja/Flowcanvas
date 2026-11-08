import { describe, expect, it } from 'vitest';
import { rankPaths, scorePath } from './fuzzy';

const FILES = [
  'apps/web/src/components/poll-form.tsx',
  'apps/web/src/utils/greeting.ts',
  'packages/database/prisma/schema.prisma',
  'apps/web/src/pages/polls/[id].tsx',
  'README.md',
  'apps/web/src/components/form-field.tsx',
];

describe('quick-open ranking', () => {
  it('needs the characters in order, ignoring case and spaces', () => {
    expect(scorePath('PF', 'apps/web/src/components/poll-form.tsx')).toBeDefined();
    expect(scorePath('poll form', 'apps/web/src/components/poll-form.tsx')).toBeDefined();
    expect(scorePath('fp', 'README.md')).toBeUndefined();
  });

  it('puts file-name matches, word starts and runs first', () => {
    expect(
      rankPaths('form', FILES)
        .map((m) => m.path)
        .slice(0, 2),
    ).toEqual(['apps/web/src/components/form-field.tsx', 'apps/web/src/components/poll-form.tsx']);
    expect(rankPaths('schema', FILES)[0]?.path).toBe('packages/database/prisma/schema.prisma');
    expect(rankPaths('greet', FILES)[0]?.path).toBe('apps/web/src/utils/greeting.ts');
  });

  it('lists everything for an empty query, shortest first, and stops at the limit', () => {
    expect(rankPaths('', FILES)[0]?.path).toBe('README.md');
    expect(rankPaths('', FILES, 2)).toHaveLength(2);
  });

  it('ranks 50,000 paths quickly', () => {
    const many = Array.from(
      { length: 50_000 },
      (_, i) => `apps/web/src/features/f${String(i % 97)}/component-${String(i)}.tsx`,
    );
    const started = performance.now();
    expect(rankPaths('comp123', many).length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
