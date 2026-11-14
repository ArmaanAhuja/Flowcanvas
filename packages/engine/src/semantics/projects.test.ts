// How a package's imports reach its source files (ADR 0026 §3, phase 8 addendum).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagePaths } from './projects.js';

describe('packagePaths', () => {
  const folder = '/repo/packages/shared';
  const manifest = {
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.mjs' },
      './types': { types: './dist/types/index.d.ts', import: './dist/types.mjs' },
      './utils': { types: './dist/utils/index.d.ts' },
      './ready': './lib/ready.ts',
    },
  };

  it('follows built files the project lacks to their source under src/, when it exists', () => {
    const files = new Set(['src/index.ts', 'src/types/index.ts', 'lib/ready.ts']);
    expect(packagePaths('shared', folder, manifest, (file) => files.has(file))).toEqual({
      shared: [join(folder, 'src/index.ts')],
      'shared/types': [join(folder, 'src/types/index.ts')],
      // No source at that place: kept as written, never guessed elsewhere.
      'shared/utils': [join(folder, './dist/utils/index.d.ts')],
      'shared/ready': [join(folder, './lib/ready.ts')],
      'shared/*': [join(folder, '*')],
    });
  });

  it('keeps a built file the project has (committed declarations)', () => {
    const files = new Set(['dist/index.d.ts', 'src/index.ts']);
    expect(packagePaths('shared', folder, manifest, (file) => files.has(file)).shared).toEqual([
      join(folder, './dist/index.d.ts'),
    ]);
  });

  it('takes every target as written when it isn’t told which files exist', () => {
    expect(packagePaths('shared', folder, manifest)['shared/types']).toEqual([
      join(folder, './dist/types/index.d.ts'),
    ]);
  });
});
