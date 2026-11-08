# 0021 — The code editor: CodeMirror 6, not Monaco

- Status: accepted (owner, 7 Nov 2026)
- Date: 7 Nov 2026
- Phase: 3, step 1
- Changes: the build plan's technology table and phase 3 named Monaco; CLAUDE.md's stack line did too. All now say CodeMirror 6, pointing here.

## Context

Phase 3 puts a code editor in the browser, synced to the workspace. The build plan named Monaco (VS Code's editor). The editor has to:
- run under our Content-Security-Policy, `style-src 'self'` with no `'unsafe-inline'` (ADR 0017 for xterm.js, ADR 0020 for the canvas)
- be light enough for **many editors at once**: phase 7 opens code cards beside nodes on the canvas
- take its colours from our tokens, which are CSS variables, in both themes
- support **diffs with accept and reject per change** (stage 3), **gutter chips** that link lines to nodes (design brief §17) and **language servers** (phase 33)
- stay fast on big files, and be accessible

The owner's direction (7 Nov 2026): the editor doesn't need to be, or look like, VS Code. Choose what suits Flowcanvas best.

## Options considered

- **Monaco 0.57.0** (MIT): VS Code's editor, with a diff editor and, since 0.57, a language-server client.
- **CodeMirror 6** (`@codemirror/*`, MIT): a modular editor built from extensions, with Lezer parsers, an official diff and merge package and an official language-server client.
- **Ace 1.45.2** (BSD-3-Clause): a long-standing editor with a strict-CSP mode.

## What the spike found (7 Nov 2026)

Each editor on its own page, built by Vite and served with our production headers, in headless Chromium (software rendering: times compare the editors with each other, they aren't real-world figures):

| | CodeMirror 6 | Ace | Monaco |
| --- | --- | --- | --- |
| Under our unchanged CSP | **0 violations** (each editor in a shadow root) | 0 violations (`useStrictCSP`) | **1,016 violations**: 0 only with `style-src-attr 'unsafe-inline'` |
| Download, gzipped | **147 kB** | 149 kB | 705 kB (trimmed: the core editor, TypeScript highlighting) |
| JS heap, 21 editors | **4.8 MB** | 4.5 MB | 12.6 MB |
| Typing in a 20,000-line file, keypress to paint (median / p95) | **12.2–12.6 / 13.7–14.7 ms** | 16.1 / 24.1 ms | 17.1 / 25.3 ms (with the exception) |
| Colours from CSS variables | Directly (`var(--…)` in its theme) | Through our own theme CSS | Hex only, set in JavaScript and redefined on every theme change |

**Why Monaco breaks the CSP:** it draws every line as an HTML string with `style="top:…px;height:…px"` (`editor/browser/viewParts/viewLines/viewLine.js:135`), inserted with `innerHTML` (`view/viewLayer.js:387`). Inline style attributes are exactly what `style-src 'self'` forbids. Its `<style>` elements could be routed into constructed stylesheets (the ADR 0017 approach) and its workers loaded from our origin instead of `blob:`, but the line rendering can't be changed without forking it.

**How CodeMirror passes:** its styling library, `style-mod`, writes rules into constructed stylesheets (`adoptedStyleSheets`), which the CSP allows. It only does so for a **shadow root** (`!root.head`, `style-mod.js:94`). On the main document it uses a `<style>` element, unless given a per-request nonce, which a static site can't provide. The spike showed both working with 0 violations:
- **each editor mounted in its own open shadow root**, passing `root` to `EditorView`
- our style adapter (an inert stand-in for `<style>`, as for xterm.js)

## Decision

**CodeMirror 6**, each editor in its own **open shadow root**. That's the library's own supported route, with no global `document.createElement` patch.

- **Packages now** (MIT, exact versions in the catalog): `@codemirror/view`, `state`, `language`, `commands`, `search`, `lang-javascript`, and `@lezer/highlight` for our highlight style from tokens. More languages (CSS, HTML, JSON, Markdown) are added in step 5 as they're wired in.
- **Later, when their phases come:**
  - `@codemirror/merge` for agent diffs with accept and reject per change (stage 3)
  - `@codemirror/lsp-client` for language servers (phase 33)
  - `y-codemirror.next` for shared editing (phase 77)
- **The CSP stays exactly as it is.** A test (step 5's walkthrough, through `watchForPageProblems`) fails on any violation.
- **Colours:** our theme and highlight style use `var(--token)` directly, so dark and light switch with no editor code.
- **Syntax only** (owner, 7 Nov): highlighting from Lezer parsers, with no type checking and no error count until phase 33.

## Consequences

- **Good:**
  - the strictest policy, untouched
  - about a fifth of Monaco's download, and about a third of its memory per editor, which matters for canvas cards
  - the fastest typing of the three
  - real parse trees for highlighting
  - official building blocks for diffs, language servers and shared editing
  - accessible and touch-friendly by design
- **Costs:**
  - **We assemble it.** Keymaps, search, folding, the gutter and the status bar are extensions we choose and configure. That's more code, but only what we ship.
  - **No built-in minimap.** Figma 11 doesn't show one; a community extension exists if ever wanted.
  - **Shadow roots retarget events.** A key event seen by a `window` listener has the editor's host element as its `target`, so code that checks the target, such as the canvas shortcuts' `isCanvasShortcut`, must use `event.composedPath()[0]`. Step 5 changes that, with a test that F, V and H typed in the editor never reach the canvas.
  - **Styles inside the shadow root** come only from CodeMirror's theme (`EditorView.theme`) and constructed sheets we adopt into it. Page CSS doesn't reach in, though CSS variables and `@font-face` do.
- **Not chosen:**
  - **Monaco:** it would need `style-src-attr 'unsafe-inline'`, it's the heaviest per editor, and its theming needs hex colours. Its strength, being VS Code, isn't a goal.
  - **Ace:** it passes the CSP and is light, but it trails on diffs, language servers, highlighting quality and accessibility, which later phases need.

## Also measured in this spike: the file watcher (for step 3)

- **inotify's limit is per user and shared with the whole computer:** 524,288 watches on the owner's laptop, of which 6,763 were in use. Workspaces run as an ordinary user, so their watches come out of the same pool.
- **One watch per folder.** Rallly's code (its pinned clone, dependencies not installed) is **599 folders**. Our own repository is 178 without `node_modules`, `.git` and build output, against 5,903 with them. An npm project's `node_modules` can reach tens of thousands.
- **So the watcher walks the project itself and skips** `node_modules`, `.git` and build output, rather than using Node's `fs.watch(…, { recursive: true })`, which on Linux can't skip anything.
- **It watches folders, not files.** `sed -i` replaces a file with a new one, so a watch on the old file would go silent.
- **Speed:** in a workspace container (Node 24), a `sed -i` was seen in a median of 3.6 ms (worst 10 ms), including starting `sed`. The end-to-end time, through the host and the control plane to the page, is measured in step 3.

## Addendum (8 Nov 2026, phase 3 step 5): building it into the page

- **The shadow root works as planned** under the production CSP: the phase 3 walkthrough types, saves and shows a conflict with **no policy violations** (`watchForPageProblems`). Playwright reaches into open shadow roots, so tests address `.cm-content` directly.
- **Canvas shortcuts** look at `event.composedPath()[0]`. A test types F in editable text inside a shadow root, and fails without the change.
- **Loading in pieces** (Vite `codeSplitting` groups, `includeDependenciesRecursively: false`):
  - the editor's core: `codemirror`, 114 kB gzipped, with the Code view
  - each language's parser on its own: `lang-javascript` 34 kB, CSS 13, HTML 12, Markdown 15, JSON 1, with its first file
  - the file tree: `FilesPanel`, 25 kB, only when Files is shown

  So a TypeScript file costs about 150 kB, as the spike estimated, and nothing of the editor is in the first load.
- **`packages/ui` is marked free of side effects** (`"sideEffects": ["**/*.css"]`), so unused components are left out of a page's bundle. The first load fell from 149.4 to 143.0 kB.
- **Syntax colours have their own tokens** (`color.syntax.*`). Owner decision, 8 Nov 2026: a quiet palette from the text colours (keywords and strings `text/secondary`, keywords semibold, comments `text/muted`), so the state hues keep meaning change and blue keeps meaning selection (Graphite outranks Figma 11, which used them for code).
