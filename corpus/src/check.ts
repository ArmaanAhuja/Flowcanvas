import { createHash } from 'node:crypto';
import type { CorpusRepo } from './manifest.ts';

/** Minimal GitHub API access, so tests can replace the network with fixed answers. */
export interface GitHubApi {
  /** Parsed JSON for an API path, or undefined for 404. */
  readonly json: (path: string) => Promise<unknown>;
  /** A file's raw content at a commit, or undefined if it doesn't exist. */
  readonly raw: (repo: string, file: string, commit: string) => Promise<string | undefined>;
}

export interface CheckResult {
  readonly repo: string;
  readonly ok: boolean;
  readonly lines: readonly string[];
}

function dependencies(packageJson: string): Set<string> {
  const parsed = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
  return new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
    ...Object.keys(parsed.peerDependencies ?? {}),
  ]);
}

/** Checks one pinned repo: the fork, the commit, the licence and the stack evidence. */
export async function checkRepo(repo: CorpusRepo, api: GitHubApi): Promise<CheckResult> {
  const lines: string[] = [];
  let ok = true;
  const pass = (text: string) => lines.push(`  ✓ ${text}`);
  const failWith = (text: string) => {
    ok = false;
    lines.push(`  ✗ ${text}`);
  };

  const info = (await api.json(`repos/${repo.fork}`)) as
    { fork?: boolean; private?: boolean; parent?: { full_name?: string } } | undefined;
  if (info === undefined) {
    failWith(`fork ${repo.fork} not found`);
    return { repo: repo.id, ok, lines };
  }
  if (info.fork === true && info.parent?.full_name?.toLowerCase() === repo.upstream.toLowerCase()) {
    pass(`${repo.fork} is a fork of ${repo.upstream}`);
  } else {
    failWith(`${repo.fork} is not a fork of ${repo.upstream}`);
  }
  if (info.private === false) pass('public');
  else failWith('fork must be public (decisions log, 29 Oct 2026)');

  const compare = (await api.json(`repos/${repo.fork}/compare/${repo.commit}...${repo.branch}`)) as
    { status?: string } | undefined;
  if (compare?.status === 'ahead' || compare?.status === 'identical') {
    pass(`commit ${repo.commit.slice(0, 7)} is on ${repo.branch}`);
  } else {
    failWith(
      `commit ${repo.commit.slice(0, 7)} is not on ${repo.branch} (${compare?.status ?? 'not found'})`,
    );
  }

  const licence = await api.raw(repo.fork, repo.licence.file, repo.commit);
  const digest =
    licence === undefined ? undefined : createHash('sha256').update(licence).digest('hex');
  if (digest === repo.licence.sha256) pass(`${repo.licence.file} unchanged (${repo.licence.spdx})`);
  else
    failWith(
      `${repo.licence.file} ${licence === undefined ? 'missing' : 'changed'}: review the licence before re-pinning`,
    );

  for (const evidence of repo.stack) {
    const file = await api.raw(repo.fork, evidence.file, repo.commit);
    if (file === undefined) {
      failWith(`${evidence.file} missing`);
      continue;
    }
    const present = dependencies(file);
    const missing = evidence.packages.filter((name) => !present.has(name));
    if (missing.length === 0) pass(`${evidence.file}: ${evidence.packages.join(', ')}`);
    else failWith(`${evidence.file}: missing ${missing.join(', ')}`);
  }
  return { repo: repo.id, ok, lines };
}

/** The real GitHub REST API; uses GITHUB_TOKEN when set (higher rate limit), anonymous otherwise. */
/** GitHub server errors retried, and the wait before the first retry (doubled for the next). */
export const RETRIES = 2;
export const RETRY_MS = 2_000;

export function gitHubApi(token = process.env.GITHUB_TOKEN): GitHubApi {
  const headers = (accept: string): Record<string, string> => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'flowcanvas-corpus-check',
    ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
  });
  const get = async (path: string, accept: string): Promise<Response | undefined> => {
    // GitHub's own errors (5xx) are retried: one 502 failed CI on 13 Nov 2026 (run 43462859685) for a file that
    // was there a minute later. A 4xx is an answer, never retried.
    let response = await fetch(`https://api.github.com/${path}`, { headers: headers(accept) });
    for (let retry = 1; retry <= RETRIES && response.status >= 500; retry += 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS * retry));
      response = await fetch(`https://api.github.com/${path}`, { headers: headers(accept) });
    }
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub API ${String(response.status)} for ${path}`);
    return response;
  };
  return {
    json: async (path) => (await get(path, 'application/vnd.github+json'))?.json(),
    raw: async (repo, file, commit) =>
      (
        await get(`repos/${repo}/contents/${file}?ref=${commit}`, 'application/vnd.github.raw')
      )?.text(),
  };
}
