/**
 * Deploys this commit from CI (owner, 13 Nov 2026), rather than relying on Cloudflare's GitHub app, which dropped some
 * pushes (`9a07d81` and `dc91add` were never built, and a walkthrough waited 10 minutes for a deployment that never
 * came). Two Workers, two targets:
 *
 *   - `--worker app`: the web app and control plane (wrangler.jsonc); `--worker catalogue`: the component catalogue
 *     (packages/ui/wrangler.jsonc).
 *   - `--to preview --branch <name>`: a version uploaded as the branch's preview, not live (pull requests).
 *     `--to staging`: deployed live (main).
 *
 *   FLOWCANVAS_COMMIT=<sha> pnpm build --filter=@flowcanvas/web
 *   node e2e/scripts/deploy.ts --worker app --to preview --branch phase/7-flow-builder --commit <sha>
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (CI's secrets; never printed). wait-for-deploy.ts then checks
 * the app serves this commit; the walkthroughs check it again.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { branchAlias } from './preview-alias.ts';

const WORKERS = {
  app: { config: 'wrangler.jsonc', built: 'apps/web/dist' },
  catalogue: { config: 'packages/ui/wrangler.jsonc', built: 'packages/ui/storybook-static' },
} as const;

const { values } = parseArgs({
  options: {
    worker: { type: 'string' },
    to: { type: 'string' },
    branch: { type: 'string' },
    commit: { type: 'string' },
  },
});
const worker = values.worker === 'app' || values.worker === 'catalogue' ? values.worker : null;
const to = values.to === 'preview' || values.to === 'staging' ? values.to : null;
if (
  worker === null ||
  to === null ||
  (to === 'preview' && (values.branch ?? '') === '') ||
  values.commit === undefined ||
  !/^[0-9a-f]{7,40}$/.test(values.commit)
) {
  console.error(
    'deploy: pass --worker app|catalogue --to preview|staging --commit <sha>, and --branch <name> for a preview',
  );
  process.exit(1);
}
const short = values.commit.slice(0, 7);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { config, built } = WORKERS[worker];
if (!existsSync(join(repo, built))) {
  console.error(`deploy: nothing built at ${built}; build the ${worker} first.`);
  process.exit(1);
}
// The app must carry this commit, or wait-for-deploy can never see it (found on CI, 13 Nov 2026: the root build
// script replaced the commit CI passed with git's answer, empty inside CI's container).
if (worker === 'app') {
  const assets = join(repo, built, 'assets');
  const stamped = readdirSync(assets).some(
    (name) => name.endsWith('.js') && readFileSync(join(assets, name), 'utf8').includes(short),
  );
  if (!stamped) {
    console.error(
      `deploy: the built app doesn't carry commit ${short}; build it with FLOWCANVAS_COMMIT set.`,
    );
    process.exit(1);
  }
}
const label = ['--tag', short, '--message', `CI ${short}`];
const args =
  to === 'preview'
    ? ['versions', 'upload', '--preview-alias', branchAlias(values.branch ?? ''), ...label]
    : ['deploy', ...label];
console.log(
  `Deploying the ${worker} at ${short} to ${to === 'preview' ? `the preview "${branchAlias(values.branch ?? '')}"` : 'staging'}…`,
);
execFileSync('pnpm', ['exec', 'wrangler', ...args, '--config', config], {
  cwd: repo,
  stdio: 'inherit',
});
