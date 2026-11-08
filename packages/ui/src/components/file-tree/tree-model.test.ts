import { describe, expect, it } from 'vitest';
import { ancestorsOf, buildTree } from './tree-model';

describe('buildTree', () => {
  it('nests files in their folders: folders first, then files, by name ignoring case, numbers in order', () => {
    expect(
      buildTree([
        'src/lib/b.ts',
        'README.md',
        'src/index.ts',
        'src/lib/a10.ts',
        'src/lib/a2.ts',
        'apps/x.ts',
        'Zeta.ts',
      ]),
    ).toEqual([
      { id: 'apps', name: 'apps', children: [{ id: 'apps/x.ts', name: 'x.ts' }] },
      {
        id: 'src',
        name: 'src',
        children: [
          {
            id: 'src/lib',
            name: 'lib',
            children: [
              { id: 'src/lib/a2.ts', name: 'a2.ts' },
              { id: 'src/lib/a10.ts', name: 'a10.ts' },
              { id: 'src/lib/b.ts', name: 'b.ts' },
            ],
          },
          { id: 'src/index.ts', name: 'index.ts' },
        ],
      },
      { id: 'README.md', name: 'README.md' },
      { id: 'Zeta.ts', name: 'Zeta.ts' },
    ]);
  });

  it('is empty for no files, and ignores empty path parts', () => {
    expect(buildTree([])).toEqual([]);
    expect(buildTree(['a//b.ts'])).toEqual([
      { id: 'a', name: 'a', children: [{ id: 'a/b.ts', name: 'b.ts' }] },
    ]);
  });

  it('builds 50,000 files quickly', () => {
    const files = Array.from(
      { length: 50_000 },
      (_, i) => `packages/p${String(i % 50)}/src/f${String(i)}.ts`,
    );
    const started = performance.now();
    const tree = buildTree(files);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(tree).toHaveLength(1);
  });
});

describe('ancestorsOf', () => {
  it('lists the folders that contain a path, outermost first', () => {
    expect(ancestorsOf('src/lib/a.ts')).toEqual(['src', 'src/lib']);
    expect(ancestorsOf('README.md')).toEqual([]);
  });
});
