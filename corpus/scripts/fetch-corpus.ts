/**
 * Fetches the corpus forks at their pins into the cache (src/cache.ts), for working on the engine against real
 * projects: one shallow fetch of exactly the pinned commit each, checked after checkout. Already-fetched forks
 * are checked and kept. Nothing is run from them; their code never enters this repository.
 *
 *   pnpm corpus:fetch              every repo in corpus/manifest.json
 *   pnpm corpus:fetch rallly       only these ids
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { cloneUrl, corpusCacheDir, corpusRepoDir } from '../src/cache.ts';
import type { CorpusManifest } from '../src/manifest.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as CorpusManifest;
const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !manifest.repos.some((repo) => repo.id === id));
if (unknown.length > 0) {
  console.error(`Not in the manifest: ${unknown.join(', ')}`);
  process.exit(1);
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Medusa's file list alone is over the 1 MB default.
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

const cache = corpusCacheDir();
mkdirSync(cache, { recursive: true });
console.log(`Cache: ${cache}`);
for (const repo of manifest.repos.filter((r) => wanted.length === 0 || wanted.includes(r.id))) {
  const dir = corpusRepoDir(repo, cache);
  const head = existsSync(`${dir}/.git`) ? git(dir, 'rev-parse', 'HEAD') : '';
  if (head === repo.commit && git(dir, 'status', '--porcelain') === '') {
    console.log(`✓ ${repo.id}: already at ${repo.commit.slice(0, 12)}`);
    continue;
  }
  // Anything else there (a half-finished fetch, local edits) is replaced by a clean checkout.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', cloneUrl(repo));
  git(dir, 'fetch', '-q', '--depth', '1', 'origin', repo.commit);
  git(dir, 'checkout', '-q', 'FETCH_HEAD');
  const fetched = git(dir, 'rev-parse', 'HEAD');
  if (fetched !== repo.commit) {
    console.error(`✗ ${repo.id}: got ${fetched}, expected ${repo.commit}`);
    process.exit(1);
  }
  const files = git(dir, 'ls-files').split('\n').length;
  console.log(
    `✓ ${repo.id}: ${String(files)} files at ${repo.commit.slice(0, 12)} in ${String(Date.now() - started)} ms`,
  );
}
