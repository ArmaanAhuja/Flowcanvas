// Where the corpus forks are kept on this computer (owner, 11 Nov 2026): a cache outside /tmp, so a restart
// doesn't lose them. Each fork is a shallow clone of exactly its pinned commit, in a folder named by that
// commit, so a new pin never reuses an old checkout. Their code never enters this repository (CLAUDE.md rule 8).
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CorpusRepo } from './manifest.ts';

/** `FLOWCANVAS_CORPUS_CACHE`, else `$XDG_CACHE_HOME/flowcanvas/corpus`, else `~/.cache/flowcanvas/corpus`. */
export function corpusCacheDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.FLOWCANVAS_CORPUS_CACHE !== undefined && env.FLOWCANVAS_CORPUS_CACHE !== '') {
    return env.FLOWCANVAS_CORPUS_CACHE;
  }
  const base =
    env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== ''
      ? env.XDG_CACHE_HOME
      : join(home, '.cache');
  return join(base, 'flowcanvas', 'corpus');
}

/** The fork's folder in the cache: `<id>@<first 12 of the commit>`. */
export function corpusRepoDir(repo: CorpusRepo, cache = corpusCacheDir()): string {
  return join(cache, `${repo.id}@${repo.commit.slice(0, 12)}`);
}

/** The fork's public clone URL (never a token in it). */
export function cloneUrl(repo: CorpusRepo): string {
  return `https://github.com/${repo.fork}.git`;
}
