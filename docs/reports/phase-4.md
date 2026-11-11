# Phase 4 — The indexer: report

- Version: `0.8.0`
- Branch: `phase/4-indexer`; PR #18
- Dates: 9–11 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

- **Build:** engine inside the workspace; tree-sitter parse of every file; symbols into SQLite; symbol search; re-index changed files on save.
- **Done when:** both forks index in under 30 s; symbol search under 100 ms.
- **Try it:** press ⌘K and jump to any function in Rallly.

**Owner decisions** (decisions log, 9–11 Nov 2026):
- **"Every file"** means every file of a language we ship a grammar for: TS, TSX, JS, JSX, CSS, JSON, HTML and Markdown. Others are listed and counted.
- **Markdown's grammar is built by us,** reproducibly, since no package ships it as WebAssembly.
- **MDX is parsed as Markdown,** marked as partly read (components not read).
- **Symbols beyond TS and JS:** Markdown headings only. CSS, HTML and JSON are parsed and counted.
- **A faster pace** (11 Nov):
  - milestones of 3–4 steps
  - heavy suites on CI through a draft pull request
  - a corpus cache outside `/tmp`
  - docs as complete as before
  - every flaky test investigated

**Settled by the documents** (applied):
- **The forks:** Rallly and Documenso are the plan's forks; all six are reported.
- **⌘K** is the command palette (Symbols, then Files; `#` for files), and Enter opens the top result.
- **A symbol opens in the Code view at its line.**
- **Indexing is not activity.**
- **100 ms counts both the engine and the browser.**
- **The progress chip** follows the design brief's "Still indexing" state.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| Engine inside the workspace | ✅ | ADR 0025. A bundled process copied into each workspace, one per running workspace, with JSON lines through the host. Every answer is checked by the host and by the API |
| Tree-sitter parse of every file | ✅ | ADR 0023. web-tree-sitter in WebAssembly with eight grammars (Markdown built reproducibly: `tools/grammars/build-markdown.sh`); every other file counted by why it wasn't parsed |
| Symbols into SQLite | ✅ | ADR 0024. `node:sqlite` with an FTS5 trigram index; functions, components, classes, methods, interfaces, types, enums, constants, namespaces, Markdown headings. 21 hand-labelled symbols found at their exact place and kind (corpus test) |
| Symbol search | ✅ | `GET …/workspace/index/search`: exact, then prefix, then word start, then anywhere (ADR 0025) |
| Re-index changed files on save | ✅ | Only changed files are parsed again (content hash). The engine's own watcher re-indexes edits in about 300 ms (Docker test, 5 runs) |
| **Done when:** both forks index in under 30 s | ✅ **Rallly 2.8 s, Documenso 4.1 s** | `corpus.docker.test.ts`: from the first request, in a real workspace (2 CPUs, 4 GiB), at their pins |
| **Done when:** symbol search under 100 ms | ✅ **engine p95 4 ms (Rallly), 8 ms (Documenso); browser 20–31 ms** | Corpus test: over 300 searches per fork. Walkthrough: keypress to results, measured in the page |
| **Try it** | ✅ recorded | `e2e/try-it/phase-4.spec.ts`: ⌘K, "createPoll", Enter, the Code view at Ln 98, Col 14 |

**All six corpus forks** (the same run):

| Fork | Files | Parsed | Symbols | Ready | Search p95 (engine) |
| --- | --- | --- | --- | --- | --- |
| Rallly | 1,958 | 1,472 | 5,633 | 2.8 s | 4 ms |
| Documenso | 2,986 | 2,508 | 9,886 | 4.1 s | 8 ms |
| LibreChat | 6,675 | 6,406 | 40,702 | 12.0 s | 34 ms |
| Twenty | 37,879 | 36,054 | 112,855 | 26.3 s | 36 ms |
| Excalidraw | 1,312 | 861 | 5,053 | 3.3 s | 14 ms |
| Medusa | 24,260 | 21,611 | 49,819 | 20.8 s | 25 ms |

Even the largest fork, Twenty, is ready within 30 s.

Like phases 1d and 3, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthroughs use a fake workspace that answers like the engine. The real engine is proven by the Docker tests, which run in CI too.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), with a project whose workspace is open (Rallly is best):
1. While it indexes, a chip under **Entry points** and on the canvas says "Indexing …%". Hover it for the counts. It goes when the index is ready, within a few seconds.
2. Press **⌘K** (Ctrl+K), or click **Search** in the top bar.
3. Type `createpoll`. Symbols come first, each with its kind and place, then files.
4. Press **Enter**. The Code view opens `apps/web/src/features/poll/mutations.ts` with the cursor on `createPoll` (Ln 98, Col 14).
5. In the dock's **Terminal**, add a function to a file: `echo 'export function hello() {}' >> apps/web/src/features/poll/mutations.ts`. ⌘K finds `hello` within a second.
6. Type `#` and part of a file's name to search files only.

**On staging** (after the merge): ⌘K and Search open the palette, which says to open the workspace (workspaces run locally for now). What's new shows 0.8.0.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 904 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 19 (1 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 130: 54 catalogue stories and 11 screens, each in both themes | `pnpm test:visual` |
| Docker (real containers) | 53 (7 new: 6 corpus forks, 1 indexing) | `pnpm test:docker` |
| Performance | 2: the canvas (unchanged) and symbol search on 100,000 names (p95 13.6 ms) | `pnpm test:perf` |
| Bundle | 8 budgets, all within | `pnpm size` |

**CI** on PR #18: green on every milestone's last commit (see "CI" below).

**Bundle (gzip):**

| Part | Size | Budget | Loads |
| --- | --- | --- | --- |
| First load | 148.5 kB | 160 | Every page (+0.6 kB: this phase's CHANGELOG entry, shown in What's new) |
| Project page | 96.3 kB | 110 | With a project |
| Quick-open and the palette (`SearchDialogs`) | 14.1 kB | 15 | Fetched once the workspace runs |
| Editor core, languages, file tree | unchanged | | |

**Mutation-checked** (each guard removed, its tests fail):
- Markdown's checksums
- case-insensitive extensions
- links never followed
- the secret-file rule
- the unchanged-file check
- runs queued
- binary detection
- the watcher started before the pass
- late search answers dropped

**Screens:** `docs/reports/phase-4-figma-differences.md`, with Figma 16 and 06 beside the built palette and the progress chip, in `docs/reports/phase-4/`.

## Deviations from plan and why

1. **The grammars aren't baked into the workspace image** (step 1's wording). The engine is copied in as a bundle when its version changes, as the agent is, so engine changes need no new image (ADR 0025).
2. **The engine has its own watcher** rather than relaying the page's, so edits are indexed whether or not a page is open (ADR 0025).
3. **Fuzzy matching of symbols** (letters in order) isn't there. Search matches every typed word inside a name (upgrade-later 45).
4. **Graphite and accessibility over Figma** for the palette's text colours, the kind shown in words, and the trigger's height. Listed in the differences document.

## Decision records added

- 0023 parsing with tree-sitter in WebAssembly, and the index in `node:sqlite` (with the spike's measurements)
- 0024 the symbol index: what a symbol is, how it's stored, incremental indexing, what's never indexed
- 0025 the engine in the workspace: a bundled process, its own watcher, status and search through the API

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33). On staging, the palette says to open the workspace.
- **One Docker run in about ten missed an edit made right after indexing finished** (step 3).
  - **What I found:** a real gap, since the watcher started at the same time as the first pass. It's fixed (watcher first) and pinned by a unit test.
  - **Not proven:** the failure didn't happen again in eight runs before the fix, so this gap isn't proven to be its cause.
  - **Watched:** the corpus and Docker tests run in CI on every push.
- **Phase 1d bug found and fixed this phase:** a request written to a workspace process that had just exited could raise an uncaught `EPIPE`. In the real host, that would end the host process. It's now handled like an exit (found by CI; `lines.test.ts`).
- **Phase 3 bugs found and fixed this phase:**
  - quick-open lost "v", "h" and "f" when opened from the Graph view
  - quick-open's rows were read out without pauses
  - a highlighted row's folder text was below AA contrast
- **The first full pass on Twenty takes 26 s:** within 30 s, but the largest projects will need the parallel parsing in the plan's performance phase (42) to stay comfortable.
- **Escape in the palette first clears the text, then closes** (React Aria's search field, as in quick-open).

**Upgrade-later review at phase end:**
- **Added this phase:**
  - 42: a published Markdown grammar
  - 43: MDX components
  - 44: the Markdown rebuild check in CI
  - 45: fuzzy symbol search
- **33** is unchanged (staging still needs a provider).
- **None of the rest is due.**

## CI

The draft PR (#18) ran CI on every push:
- milestones A and B were green on their last commits
- step 5's push failed only the screen baselines (the top bar's new Search button), which step 6 regenerated

The result for this closing commit is recorded below when it finishes.

## Next phase preview

**Phase 5, TypeScript call graphs:**
- name resolution with the TypeScript compiler API, in the engine
- callers and callees for any function
- the first resolved edges, which phase 6's graph model builds on
