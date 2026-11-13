import { describe, expect, it } from 'vitest';
import { selectRepos } from './select.js';

const repos = ['rallly', 'documenso', 'twenty', 'medusa'].map((id) => ({ id }));
const ids = (env: { only?: string; except?: string }) => selectRepos(repos, env).map((r) => r.id);

describe('selectRepos', () => {
  it('opens every project when nothing is set, as on a laptop', () => {
    expect(ids({})).toEqual(['rallly', 'documenso', 'twenty', 'medusa']);
  });

  it('opens only the named ones, or everything but the named ones, in manifest order', () => {
    expect(ids({ only: 'twenty' })).toEqual(['twenty']);
    expect(ids({ except: 'medusa, twenty' })).toEqual(['rallly', 'documenso']);
  });

  it('refuses a name the manifest lacks, both at once, and a selection of nothing', () => {
    expect(() => ids({ only: 'twentyy' })).toThrow('Not in corpus/manifest.json: twentyy.');
    expect(() => ids({ only: 'twenty', except: 'medusa' })).toThrow('not both');
    expect(() => ids({ except: 'rallly,documenso,twenty,medusa' })).toThrow('opens no corpus');
  });
});
