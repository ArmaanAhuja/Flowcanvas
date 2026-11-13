/**
 * Uploads this commit's web app and control plane as its branch's preview (owner, 13 Nov 2026): CI deploys every
 * pushed commit itself, rather than relying on Cloudflare's GitHub app, which dropped some pushes (`9a07d81` and
 * `dc91add` were never built, and a walkthrough waited 10 minutes for a deployment that never came).
 *
 *   FLOWCANVAS_COMMIT=<sha> pnpm build --filter=@flowcanvas/web
 *   node e2e/scripts/deploy-preview.ts --branch phase/7-flow-builder --commit <sha>
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (CI's secrets; never printed). wait-for-deploy.ts then checks
 * the preview serves this commit, as before.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { branchAlias } from './preview-alias.ts';

const { values } = parseArgs({
  options: { branch: { type: 'string' }, commit: { type: 'string' } },
});
if (
  values.branch === undefined ||
  values.commit === undefined ||
  !/^[0-9a-f]{7,40}$/.test(values.commit)
) {
  console.error('deploy-preview: pass --branch <name> --commit <sha>');
  process.exit(1);
}
const short = values.commit.slice(0, 7);
const alias = branchAlias(values.branch);
const repo = fileURLToPath(new URL('../../', import.meta.url));
console.log(`Uploading ${short} as the preview "${alias}"…`);
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'versions',
    'upload',
    '--preview-alias',
    alias,
    '--tag',
    short,
    '--message',
    `CI ${short}`,
  ],
  { cwd: repo, stdio: 'inherit' },
);
