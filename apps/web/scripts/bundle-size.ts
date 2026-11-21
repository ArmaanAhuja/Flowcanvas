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

/** kB gzipped (1 kB = 1000 bytes, as Vite reports). Set at about 10% above the sizes when each part was added. */
export const BUDGETS: Readonly<Record<string, number>> = {
  // 7 Nov 2026 (phase 2): 149.4 kB then; 143.0 since phase 3 marked packages/ui free of side effects.
  'First load': 160,
  // Raised 95 → 110 on 8 Nov 2026 (owner: "choose the best"): phase 3's journal and autosave (93.1 kB) must run
  // whenever a project is open, the Graph view included, to keep unsaved work safe; loading them lazily would only
  // delay that protection. Raised 110 → 115 on 15 Nov 2026 (phase 8, 110.6 kB): the entry points' lists, groups, `/`
  // shortcut and notices (1.6 kB) are needed whenever a project is open, as the left panel's default; the panel
  // itself (React Aria's tree and virtualizer) loads on its own, below. Raised 115 → 120 on 16 Nov 2026 (phase 12,
  // 116.5 kB): a large flow's grouping, its group card and the grouped layout (about 3.6 kB) are needed whenever a
  // flow is on the canvas, the default view; the sequence view (phase 13) loads on its own, when chosen.
  ProjectPage: 120,
  // The terminal's own code (1.7 kB); xterm.js itself is shared with the desktop app's process cards since build
  // plan v2 phase 3 (22 Nov 2026), in its own chunk (84.6 kB then), loaded with the first terminal.
  WorkspaceTerminal: 5,
  xterm: 95,
  // 8 Nov 2026 (phase 3): the editor's core, only with the Code view (115.5 kB; ADR 0021 estimated about 150 with
  // a language).
  codemirror: 130,
  // Every language's parser together (74.8 kB); each loads on its own, with its first file (JavaScript 33.7 kB).
  lang: 85,
  // The file tree, only when Files is shown (24.9 kB with React Aria's virtualizer; 2.5 kB since phase 8, when the
  // virtualizer moved to the chunk both left panels share; lowered 30 → 5 then).
  FilesPanel: 5,
  // 15 Nov 2026 (phase 8): the entry-points panel (3.7 kB with its styles), loaded with the left panel...
  EntryPointsLeft: 6,
  // ...and React Aria's virtualizer and tree parts, shared by both left panels (22.5 kB; Rollup names the chunk after
  // its first module).
  Virtualizer: 27,
  // 8 Nov 2026 (phase 3 step 7): quick-open, fetched once the workspace runs (11.8 kB). 11 Nov 2026 (phase 4 step
  // 5): with the command palette, one chunk, since they share React Aria's search parts (13.7 kB together).
  SearchDialogs: 15,
  // 13 Nov 2026 (phase 7 step 6): ELK, the flow layout the build plan names (ADR 0028), 445 kB: its worker, fetched
  // the first time a flow is opened, run off the page's main thread, then cached by the browser. Never in the first
  // load; dagre (smaller) is unmaintained and was considered in ADR 0028.
  elk: 490,
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
