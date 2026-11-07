// The web app's bundle-size budget (upgrade-later 18): run after `vite build`. Measures what a browser downloads
// (gzip), grouped as people meet it, and fails when a group goes over its budget, so growth is a decision, not
// an accident. On CI it also writes the table to the job summary.
//
// - "First load": what dist/index.html loads before anything appears (its script, preloads and stylesheets).
// - Each lazily loaded chunk (the project page, the terminal), by its name.
//
// Raising a budget is fine when the growth is wanted: change it here, in the same commit, and say why.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/** kB gzipped (1 kB = 1000 bytes, as Vite reports). Set 7 Nov 2026 at about 10% above the sizes then. */
export const BUDGETS: Readonly<Record<string, number>> = {
  'First load': 160,
  ProjectPage: 95,
  WorkspaceTerminal: 95,
  'Other lazy chunks': 20,
};

const dist = new URL('../dist/', import.meta.url);
const assets = readdirSync(new URL('assets/', dist)).filter((name) => /\.(js|css)$/.test(name));
const html = readFileSync(new URL('index.html', dist), 'utf8');
const firstLoad = new Set(
  [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((match) => match[1]),
);

const gzipped = (name: string) =>
  gzipSync(readFileSync(new URL(`assets/${name}`, dist)), { level: 9 }).length;

const totals = new Map<string, number>(Object.keys(BUDGETS).map((group) => [group, 0]));
for (const name of assets) {
  const chunk = /^([A-Za-z]+)-/.exec(name)?.[1] ?? '';
  const group = firstLoad.has(name) ? 'First load' : chunk in BUDGETS ? chunk : 'Other lazy chunks';
  totals.set(group, (totals.get(group) ?? 0) + gzipped(name));
}

const rows = [...totals].map(([group, bytes]) => {
  const kb = bytes / 1000;
  const budget = BUDGETS[group] ?? 0;
  return { group, kb, budget, over: kb > budget };
});

const table = [
  '| Part | Size (gzip) | Budget | |',
  '| --- | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| ${row.group} | ${row.kb.toFixed(1)} kB | ${String(row.budget)} kB | ${row.over ? 'over' : 'ok'} |`,
  ),
].join('\n');

console.log(`Web bundle size\n\n${table}\n`);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined && summary !== '') {
  appendFileSync(summary, `### Web bundle size\n\n${table}\n`);
}

const over = rows.filter((row) => row.over);
if (over.length > 0) {
  console.error(
    `Over budget: ${over.map((row) => row.group).join(', ')}. Make it smaller, or raise the budget in apps/web/scripts/bundle-size.ts and say why.`,
  );
  process.exit(1);
}
