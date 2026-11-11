import { describe, expect, it } from 'vitest';
import { cloneUrl, corpusCacheDir, corpusRepoDir } from './cache.ts';
import type { CorpusRepo } from './manifest.ts';

const repo = {
  id: 'rallly',
  fork: 'ArmaanAhuja-7777/rallly',
  commit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
} as CorpusRepo;

describe('the corpus cache', () => {
  it('lives outside /tmp: the variable, then XDG, then ~/.cache', () => {
    expect(corpusCacheDir({ FLOWCANVAS_CORPUS_CACHE: '/data/corpus' }, '/home/ada')).toBe(
      '/data/corpus',
    );
    expect(corpusCacheDir({ XDG_CACHE_HOME: '/home/ada/.xdg' }, '/home/ada')).toBe(
      '/home/ada/.xdg/flowcanvas/corpus',
    );
    expect(corpusCacheDir({}, '/home/ada')).toBe('/home/ada/.cache/flowcanvas/corpus');
    expect(corpusCacheDir({ FLOWCANVAS_CORPUS_CACHE: '', XDG_CACHE_HOME: '' }, '/home/ada')).toBe(
      '/home/ada/.cache/flowcanvas/corpus',
    );
  });

  it('keeps each pin in its own folder, and clones the public fork', () => {
    expect(corpusRepoDir(repo, '/c')).toBe('/c/rallly@8e67a2161a2d');
    expect(cloneUrl(repo)).toBe('https://github.com/ArmaanAhuja-7777/rallly.git');
  });
});
