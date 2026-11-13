/**
 * Waits until a deployed copy of the web app serves a given commit, so tests never run against the
 * previous deployment while Cloudflare is still building (it starts at the same time as CI).
 *
 *   node scripts/wait-for-deploy.ts --branch phase/1b-see-and-test --commit <sha>   the branch's preview
 *   node scripts/wait-for-deploy.ts --url https://flowcanvas.<sub>.workers.dev --commit <sha>   e.g. staging
 *
 * The subdomain comes from CLOUDFLARE_WORKERS_SUBDOMAIN. Prints the URL, and writes `url=` to GITHUB_OUTPUT in CI.
 */
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { WORKER, branchAlias } from './preview-alias.ts';

/**
 * A new deployment reaches Cloudflare's servers over a short while: one request can get it while the next still gets
 * the old one. Found on 12 Nov 2026 (run 43271058049): the check saw the new commit once, then phase 1's walkthrough
 * got the previous build three times in a minute. So the commit must be served this many times in a row, this far
 * apart, before tests run; a miss starts the count again.
 */
const STABLE_CHECKS = 5;
const STABLE_GAP_MS = 5_000;

function fail(message: string): never {
  console.error(`wait-for-deploy: ${message}`);
  process.exit(1);
}

/** The commit the deployment was built from, read from its JavaScript bundle (the version line embeds it). */
async function servesCommit(base: string, shortCommit: string): Promise<boolean> {
  const page = await fetch(base, { cache: 'no-store' });
  if (!page.ok) return false;
  const html = await page.text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  for (const script of scripts) {
    if (script === undefined) continue;
    const bundle = await fetch(new URL(script, base), { cache: 'no-store' });
    if (bundle.ok && (await bundle.text()).includes(shortCommit)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      branch: { type: 'string' },
      commit: { type: 'string' },
      timeout: { type: 'string', default: '600' },
    },
  });
  if (values.commit === undefined || !/^[0-9a-f]{7,40}$/.test(values.commit)) {
    fail('pass --commit <sha>');
  }
  const shortCommit = values.commit.slice(0, 7);
  let base = values.url;
  if (base === undefined) {
    const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;
    if (values.branch === undefined || subdomain === undefined || subdomain === '') {
      fail('pass --url, or --branch with CLOUDFLARE_WORKERS_SUBDOMAIN set');
    }
    base = `https://${branchAlias(values.branch)}-${WORKER}.${subdomain}.workers.dev/`;
  }

  const deadline = Date.now() + Number(values.timeout) * 1000;
  console.log(`Waiting for ${base} to serve ${shortCommit}…`);
  let inARow = 0;
  for (;;) {
    let served = false;
    try {
      served = await servesCommit(base, shortCommit);
    } catch (error) {
      console.log(`  not reachable yet (${(error as Error).message})`);
    }
    if (served) {
      inARow += 1;
      if (inARow >= STABLE_CHECKS) break;
    } else {
      if (inARow > 0)
        console.log(`  served ${String(inARow)} time(s), then an older build: waiting again`);
      inARow = 0;
    }
    if (Date.now() > deadline) {
      fail(
        `${base} still doesn't serve ${shortCommit} steadily after ${values.timeout} s. Check CI's deploy step (deploy.ts) above.`,
      );
    }
    await sleep(served ? STABLE_GAP_MS : 10_000);
  }
  console.log(`${base} serves ${shortCommit} (${String(STABLE_CHECKS)} checks in a row).`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${base}\n`);
}

await main();
