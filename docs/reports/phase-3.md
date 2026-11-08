# Phase 3 — Open a repo and edit: report

- Version: `0.7.0`
- Branch: `phase/3-open-repo-and-edit`; PR: see `docs/STATUS.md`
- Dates: 7–8 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

- **Build:** CodeMirror 6 in the browser (the plan said Monaco; ADR 0021) with the buffer synced to the workspace; tabs, save, undo, quick-open; autosave journal every few seconds; file watcher.
- **Done when:** edits survive closing the tab and reopening; an edit made in the terminal appears in the editor.
- **Try it:** edit a file in Rallly, close the tab, reopen it: the change is still there.

**Owner decisions** (decisions log, 7–8 Nov 2026):
- **Saving:**
  - Ctrl/⌘+S at once
  - autosave after 5 s without typing, and on switching file, leaving the Code view or leaving the window, with a switch that's on by default
  - the journal every 2 s and as the page closes
- **The editor is CodeMirror 6, not Monaco:**
  - it runs under the unchanged strict CSP
  - it's light enough for many editors on the canvas
  - it takes colours from tokens
- **The Code view (Figma 11).** The editor card on the canvas comes with phase 7.
- **No fake errors:** syntax highlighting only, and no error count until phase 33.
- **A quiet code palette:** the state hues keep meaning change, and blue keeps meaning selection.
- **A file deleted in the workspace while open:** Close; or, with unsaved changes, Save it again or Close…, which asks first.
- **A faster working pace,** with every test and document kept (CLAUDE.md section 4a).
- **The project page's budget is 110 kB.**

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| CodeMirror 6 in the browser | ✅ | ADR 0021. Each editor in an open shadow root; 0 CSP violations in every walkthrough (`watchForPageProblems`) |
| The buffer synced to the workspace | ✅ | ADR 0022. Versioned, conflict-safe saves (agent protocol 2); the workspace's changes reach open files live |
| Tabs, save, undo | ✅ | `EditorTabs`; Ctrl/⌘+S; each file keeps its own undo history (its `EditorState`). `CodeView.test.tsx`, the walkthroughs |
| Quick-open | ✅ | Ctrl/⌘+P, `QuickOpen` with fuzzy ranking (`packages/ui`); walkthrough "an edit made in the terminal appears in the editor; quick-open; a deleted file" |
| Autosave journal every few seconds | ✅ | The journal in the workspace every 2 s and on close, and in IndexedDB within 300 ms; autosave after 5 s (`useCodeFiles.test.ts`, 13 tests) |
| File watcher | ✅ | `workspace/agent/src/watch.ts`; real container: Rallly is 599 folders, and a `sed -i` reached the page's socket in 162 ms (`host.docker.test.ts`) |
| **Done when:** edits survive closing the tab and reopening | ✅ in a real browser · ✅ locally with a real workspace | Walkthrough "phase 3 · Try it": edit, close the tab at once, reopen: the change is there, unsaved, with a note; autosave then writes it; a fresh browser restores from the workspace's copy. The journal surviving a stopped workspace: Docker test |
| **Done when:** an edit made in the terminal appears in the editor | ✅ in a real browser · ✅ locally with a real workspace | Walkthrough: the terminal's write shows in the editor, with unsaved changes the banner, and a deleted file. Real container: `sed -i` → the right event, version and timing (Docker) |
| **Try it** | ✅ recorded | `e2e/try-it/phase-3.spec.ts` (3 walkthroughs) |

Like phase 1d, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthroughs use a fake workspace with real versions and conflict checks, and the real containers are proven by the Docker tests (in CI too).

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), with a project whose workspace is open:
1. Click **Code** in the top bar (or **Files** on the rail) and open a file from the tree.
2. Type a line. The tab and the tree row get a dot, and the status bar says "Unsaved changes".
3. **Close the browser tab at once,** then open the project again: your line is there, with "Restored unsaved changes from …". Wait 5 seconds: autosave writes it ("Saved").
4. Open the **Terminal** (rail) and change that file, for example `sed -i 's/a/b/' <file>`. The editor shows the change.
5. Type again, then change the file in the terminal: a banner offers **Keep mine** or **Load the workspace's version**.
6. Press **Ctrl/⌘+P**, type part of a file's name, and press Enter.
7. `rm` an open file in the terminal: its tab says it was deleted.

**On staging** (after the merge): the Code view says "Open the workspace to see its files", because workspaces run only locally for now. What's new shows 0.7.0.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 747 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 18 (3 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 114: 80 catalogue stories, 15 screens | `pnpm test:visual` |
| Docker (real containers) | 46 (4 new) | `pnpm test:docker` |
| Canvas performance | 1 | `pnpm test:perf` (unchanged) |
| Bundle | 8 budgets, all within | `pnpm size` |

**Bundle (gzip):**

| Part | Size | Budget | Loads |
| --- | --- | --- | --- |
| First load | 147.2 kB | 160 | Every page |
| Project page | 94.6 kB | 110 | With a project |
| Editor core (`codemirror`) | 114.2 kB | 130 | With the Code view |
| Each language | 1–34 kB (73.2 kB together) | 85 | With its first file |
| File tree | 24.9 kB | 30 | When Files is shown |
| Quick-open | 11.8 kB | 14 | Fetched once the workspace runs |

**Mutation-checked** (each guard removed, its tests fail):
- the agent's conflict check and its journal revisions
- the watcher's secret filter and its dedupe
- the tree's reveal
- a stale restore's base
- echo recognition, the unsaved-text guard, and the check after a save
- no save on arriving in the Code view

**Screens:** `docs/reports/phase-3-figma-differences.md`, with Figma 11 and 16 beside the built Code view, a conflict, and quick-open, in `docs/reports/phase-3/`.

## Deviations from plan and why

1. **CodeMirror 6 instead of Monaco** (owner, ADR 0021). Monaco draws every line with inline styles, which our CSP forbids. CodeMirror passes the unchanged policy, is about a fifth of the size, and is lighter per editor.
2. **The editor card on the canvas** is phase 7, when nodes have code to open (owner).
3. **No error count** until language servers (phase 33): no fake errors (owner).
4. **A quiet code palette** instead of Figma 11's coloured code (owner; Graphite outranks Figma).
5. **Quick-open lists files only.** Nodes and commands (Figma 16) come with their phases.
6. **Graphite over Figma on spacing and text colours** (the 4 px grid; `text/muted` for small text). Listed in the differences document.

## Decision records added

- 0021 the code editor: CodeMirror 6, not Monaco (with the measurements, and an addendum on building it into the page)
- 0022 file sync with the workspace: versions, the journal and the watcher (addenda: the page's journal and autosave; the page following the workspace)

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33): the Code view on staging says to open the workspace.
- **Upgrade-later 2 is due:** Node 26 became LTS on 28 Oct 2026. It touches the workspace image, CI, `.nvmrc` and Cloudflare's build, so it goes in its own pull request right after this phase merges.
- **The first load is at 147.2 of 160 kB.** It grew 4.2 kB this phase, from React Aria parts that quick-open shares with menus. The next shared component should be checked for what it adds.
- **Two unexplained one-off failures to watch:** one Docker run left test containers behind (step 2; clean runs since), and one visual run ended with 105 of 106 (step 4; clean runs since).
- **Undo after a change from the workspace:** following the disk is one undoable change, so Ctrl+Z can bring back the earlier text, which is then unsaved. That's intended, but noted.

**Upgrade-later review at phase end:**
- 2 is due (above).
- 33 is unchanged (staging still needs a provider).
- None of the rest is due; nothing was added this phase.

## After the merge (owner)

There are no database migrations. On staging, check:
1. What's new shows 0.7.0.
2. A project's **Code** view says "Open the workspace to see its files."

## Next phase preview

**Phase 4, the indexer:**
- an engine inside the workspace
- every file parsed with tree-sitter, symbols in SQLite, symbol search
- changed files re-indexed on save

**Done when:** both forks index in under 30 s, and symbol search answers in under 100 ms. **Try it:** press ⌘K and jump to any function in Rallly.
