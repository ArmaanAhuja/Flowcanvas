/**
 * Publishes the latest test reports as one small site on the `flowcanvas-reports` Worker (ADR 0011):
 * an index page, the walkthroughs report (videos and traces) and, when present, the accessibility report.
 *
 *   node scripts/publish-report.ts --alias pr-12          a new version, also reachable as pr-12-flowcanvas-reports…
 *   node scripts/publish-report.ts --alias main --production   also make it the Worker's main address
 *   node scripts/publish-report.ts --alias x --assemble-only   build report-site/ only, for `wrangler dev`
 *
 * Also writes reports-data/links.json and reports-data/comment.md (the PR comment; PREVIEW_URL adds the preview).
 * Needs Wrangler credentials: `wrangler login` locally, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in CI.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { parseArgs } from 'node:util';

const WORKER = 'flowcanvas-reports';
const here = new URL('../', import.meta.url);
const path = (relative: string): string => new URL(relative, here).pathname;

interface Summary {
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

interface Section {
  readonly name: string;
  readonly folder: string;
  readonly summary: Summary;
}

function fail(message: string): never {
  console.error(`publish-report: ${message}`);
  process.exit(1);
}

/** Aliases become a DNS label: lowercase letters, digits and dashes, starting with a letter, ≤ 63 with the name. */
function checkAlias(alias: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(alias)) {
    fail(`alias "${alias}" must be lowercase letters, digits and dashes, starting with a letter`);
  }
  if (alias.length + 1 + WORKER.length > 63) {
    fail(`alias "${alias}" is too long (at most ${String(62 - WORKER.length)} characters)`);
  }
  return alias;
}

function readSummary(file: string): Summary {
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    stats: { expected: number; unexpected: number; flaky: number; skipped: number };
  };
  const { expected, unexpected, flaky, skipped } = report.stats;
  return { passed: expected, failed: unexpected, flaky, skipped };
}

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function countsText(summary: Summary): string {
  return [
    `${String(summary.passed)} passed`,
    summary.failed > 0 ? `${String(summary.failed)} failed` : '',
    summary.flaky > 0 ? `${String(summary.flaky)} flaky` : '',
    summary.skipped > 0 ? `${String(summary.skipped)} skipped` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The PR comment. The marker lets CI find and edit its own comment instead of adding a new one per push. */
function commentBody(
  sections: readonly Section[],
  commit: string,
  aliasUrl: string | undefined,
  versionUrl: string | undefined,
): string {
  const preview = process.env.PREVIEW_URL;
  const rows = sections.map(
    ({ name, summary }) =>
      `| ${name} | ${summary.failed > 0 ? '❌' : '✅'} ${countsText(summary)} |`,
  );
  return [
    '<!-- flowcanvas-ci -->',
    `### Preview and test report for \`${commit.slice(0, 7)}\``,
    '',
    ...(preview !== undefined && preview !== '' ? [`- **Preview:** ${preview}`] : []),
    ...(aliasUrl !== undefined
      ? [`- **Test report:** ${aliasUrl} (videos and traces under Walkthroughs)`]
      : []),
    ...(versionUrl !== undefined
      ? [`- This run only: ${versionUrl} (may expire; the link above always shows the latest run)`]
      : []),
    '',
    '| Suite | Result |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function indexPage(
  sections: readonly Section[],
  commit: string,
  branch: string,
  when: string,
): string {
  const rows = sections
    .map(({ name, folder, summary }) => {
      const state = summary.failed > 0 ? 'failed' : 'passed';
      const counts = countsText(summary);
      return `<li><a href="${folder}/">${escape(name)}</a><span class="${state}">${escape(counts)}</span></li>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flowcanvas test report · ${escape(commit.slice(0, 7))}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0c0e;color:#edeff2;font:13px/20px system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px;display:grid;gap:16px}h1{margin:0;font-size:20px;line-height:28px}
p{margin:0;color:#a3aab5}code{font:12px/18px ui-monospace,monospace;color:#edeff2}
ul{list-style:none;margin:0;padding:0;border:1px solid #2c323a;border-radius:8px;background:#111317}
li{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #2c323a}li:last-child{border-bottom:0}
a{color:#edeff2;font-weight:500}.passed{color:#65b186}.failed{color:#e39289}
</style></head><body><main>
<h1>Test report</h1>
<p>Commit <code>${escape(commit)}</code> on <code>${escape(branch)}</code> · ${escape(when)}</p>
<ul>
${rows}
</ul>
<p>Open a report to see each test's steps. Walkthroughs include a video and a trace (click it to step through every action).</p>
</main></body></html>
`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      alias: { type: 'string' },
      production: { type: 'boolean', default: false },
      // Build report-site/ and stop: for checking the site locally with `wrangler dev`.
      'assemble-only': { type: 'boolean', default: false },
    },
  });
  if (values.alias === undefined) fail('pass --alias <name>, e.g. --alias pr-12');
  const alias = checkAlias(values.alias);

  const sources = [
    {
      name: 'Walkthroughs (try-it)',
      folder: 'walkthroughs',
      report: 'playwright-report',
      data: 'reports-data/walkthroughs.json',
    },
    {
      name: 'Accessibility (catalogue)',
      folder: 'a11y',
      report: 'playwright-report-a11y',
      data: 'reports-data/a11y.json',
    },
  ];
  const site = path('report-site/');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });

  const sections: Section[] = [];
  for (const source of sources) {
    if (!existsSync(path(source.report)) || !existsSync(path(source.data))) continue;
    cpSync(path(source.report), `${site}${source.folder}`, { recursive: true });
    sections.push({
      name: source.name,
      folder: source.folder,
      summary: readSummary(path(source.data)),
    });
  }
  if (!sections.some((section) => section.folder === 'walkthroughs')) {
    fail('no walkthroughs report found; run `pnpm test:e2e` first');
  }

  // CI's COMMIT is the commit it tested. On pull requests GITHUB_SHA is GitHub's temporary merge commit instead.
  const commit = process.env.COMMIT ?? process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
  // GITHUB_HEAD_REF is set but empty outside pull requests, so an empty value falls through on purpose.
  const headRef = process.env.GITHUB_HEAD_REF;
  const branch =
    headRef !== undefined && headRef !== ''
      ? headRef
      : (process.env.GITHUB_REF_NAME ?? git('rev-parse', '--abbrev-ref', 'HEAD'));
  writeFileSync(`${site}index.html`, indexPage(sections, commit, branch, new Date().toUTCString()));
  cpSync(path('reports/_headers'), `${site}_headers`);

  if (values['assemble-only']) {
    console.log(`Assembled ${site} (not uploaded).`);
    return;
  }

  const config = path('reports.wrangler.jsonc');
  const message = `${branch} @ ${commit.slice(0, 7)}`;
  const uploadVersion = () =>
    spawnSync(
      'wrangler',
      ['versions', 'upload', '--config', config, '--preview-alias', alias, '--message', message],
      { encoding: 'utf8' },
    );
  let upload = uploadVersion();
  // A Worker must exist before it can have versions: the very first publish deploys it once, then uploads.
  if (
    upload.status !== 0 &&
    /does not (yet )?exist|not found|10007/i.test(`${upload.stdout}${upload.stderr}`)
  ) {
    const create = spawnSync('wrangler', ['deploy', '--config', config, '--message', message], {
      encoding: 'utf8',
    });
    if (create.status !== 0)
      fail(`creating the Worker failed:\n${create.stdout}\n${create.stderr}`);
    upload = uploadVersion();
  }
  const output = `${upload.stdout}\n${upload.stderr}`;
  if (upload.status !== 0) fail(`wrangler versions upload failed:\n${output}`);

  const urls = [...new Set(output.match(/https:\/\/[^\s"']+\.workers\.dev/g) ?? [])];
  const aliasUrl = urls.find((url) => url.startsWith(`https://${alias}-${WORKER}.`));
  const versionUrl = urls.find((url) => url !== aliasUrl);
  const versionId = /Worker Version ID:\s*([0-9a-f-]{36})/.exec(output)?.[1];

  let productionUrl: string | undefined;
  if (values.production) {
    if (versionId === undefined)
      fail(`could not read the version ID from Wrangler's output:\n${output}`);
    const deploy = spawnSync(
      'wrangler',
      [
        'versions',
        'deploy',
        `${versionId}@100%`,
        '--config',
        config,
        '--yes',
        '--message',
        message,
      ],
      { encoding: 'utf8' },
    );
    const deployOutput = `${deploy.stdout}\n${deploy.stderr}`;
    if (deploy.status !== 0) fail(`wrangler versions deploy failed:\n${deployOutput}`);
    productionUrl = aliasUrl?.replace(`https://${alias}-`, 'https://');
  }

  const links = { commit, branch, alias, aliasUrl, versionUrl, productionUrl, sections };
  writeFileSync(path('reports-data/links.json'), `${JSON.stringify(links, null, 2)}\n`);
  writeFileSync(
    path('reports-data/comment.md'),
    commentBody(sections, commit, aliasUrl, versionUrl),
  );
  const lines = [
    `Report for ${message}`,
    aliasUrl ? `  latest for ${alias}: ${aliasUrl}` : '',
    versionUrl ? `  this run:          ${versionUrl}` : '',
    productionUrl ? `  main address:      ${productionUrl}` : '',
  ].filter(Boolean);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Test report\n\n${[aliasUrl, versionUrl, productionUrl]
        .filter(Boolean)
        .map((url) => `- ${String(url)}`)
        .join('\n')}\n`,
    );
  }
}

main();
