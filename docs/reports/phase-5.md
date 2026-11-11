# Phase 5 — TypeScript semantics: report

- Version: `0.9.0`
- Branch: `phase/5-typescript-semantics`; PR #19
- Dates: 12 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

- **Build:** TypeScript compiler API service: definitions, references, type-resolved call edges; callers and callees panel.
- **Done when:** callers and callees for 20 hand-picked functions match a manual check.
- **Try it:** right-click a function → Callers; compare with your own reading of the code.

**Owner decisions** (decisions log, 12 Nov 2026):
1. **The right panel's Calls tab** shows callers and callees.
2. **Project code only, honestly:** calls into packages that aren't installed are unresolved, never guessed; nothing installs by itself.
3. **Rendering counts as a call,** marked "renders".
4. **Claude picks and labels the 20 functions** (10 in Rallly, 10 in Documenso).
5. **Built-ins** in a separate, collapsed group; unresolved calls in their own group.
6. **A caller outside any named function** is named by its file: `route.ts (top level)`.
7. **References** in the same Calls tab, as a third view.
- **Visual tolerance:** up to 4 differing pixels per screenshot, for anti-aliasing (`threshold` stays 0).

**Settled by the documents** (applied; decisions log):
- **TypeScript 6.0.3:** upgrade-later 3 checked; TypeScript 7's API is still unstable.
- **Provenance glyphs** follow Graphite: a solid line for resolved; an open stub ending in a hollow circle for unresolved; the word beside it.
- **F12 and Shift+F12** for definition and references.
- **The tab is "Calls"** (Figma), not the design brief's "Connections": Figma outranks the brief.
- **A call through a parameter or a local is unresolved;** built-ins, module-level constants and interface or class members are resolved (step 6, from CLAUDE.md rule 4 and decision 2).

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| TypeScript compiler API service | ✅ | ADR 0026: one language service per `tsconfig.json` in a worker thread capped at 2.5 GB, built per question and released least recently used first. Path aliases, workspace packages and re-exports resolve without `node_modules` |
| Definitions | ✅ | F12; `GET …/index/definition`; engine fixture tests (aliases, re-exports, a built-in) |
| References | ✅ | Shift+F12; `GET …/index/references`; the definition marked |
| Type-resolved call edges | ✅ | Callers and callees with *calls* or *renders* and *resolved* or *unresolved* on every entry (CLAUDE.md rule 4) |
| Callers and callees panel | ✅ | The inspector's Calls tab (`CallsPanel`), in the catalogue and three screens |
| **Done when:** 20 hand-picked functions match a manual check | ✅ **Rallly 10 of 10, Documenso 10 of 10, exactly** | `corpus/labels/calls.json`, labelled by reading the source; `corpus.docker.test.ts` in real workspaces on CI (every caller with its lines, every callee with its provenance, declaration and lines; nothing extra) |
| **Try it** | ✅ recorded | `e2e/try-it/phase-5.spec.ts`: right-click `createPoll` → Callers, open a caller at its line, Callees in their groups, Shift+F12 |

**The 20 functions** cover: plain functions; const arrows; generic functions; class methods (private, through `this`, through an implemented interface); components rendered, including from an arrow inside a conditional; a component re-exported by a barrel and imported by package path; a workspace package through its `exports`; callers in route handlers, `cache()` and `Effect.fn` callbacks, tRPC procedures and tests; Prisma without its generated client; DOM and standard-library built-ins; calls through parameters.

**How the manual check went:** callers matched from the first comparison. Callees exposed six engine faults, fixed one by one with tests that fail without each fix (ADR 0026 addendum):
1. **TypeScript's DOM library was never loaded:** the host's 1 MB file limit cut `lib.dom.d.ts` (2.3 MB), so `fetch`, `URL` and `setTimeout` were unresolved in every web project.
2. **A `const` arrow's unresolved calls were collected from its whole file.**
3. **A named function inside the body** had its unresolved calls credited to the outer one.
4. **Constants holding functions and built-ins declared as variables were dropped** (`nanoid`, `Boolean`, `new Error`).
5. **Built-in overloads made duplicate rows,** and a call could be listed twice.
6. **Unresolved names carried their arguments** (`Buffer.concat([ … ]).toString`).

Two labels were wrong and the engine right: Prisma's package calls its own copy of `remember`, and a caller exists in `packages/ee` (named from its import and declaration lines only; nothing there is run or enabled).

**Speed** (CI, real workspaces, 2 CPUs and 4 GiB): the first question about a project takes 2.4 s (Rallly) and 6.1 s (Documenso) while its programs build; later ones are fast (Rallly: `Button`'s 149 callers in 1.2 s). Rallly's index is ready in about 4.6 s, under the 30 s target, now including TypeScript's first copy into the workspace.

**Memory with every program built** (laptop, heap after GC): Rallly 0.38 GB, Documenso 0.75 GB, including the DOM library (+0.15 and +0.18 GB). Twenty never fits whole; it answers from the programs a question needs (ADR 0026).

Like phases 1d, 3 and 4, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthroughs use a fake workspace answering like the engine; the real engine is proven by the Docker tests, which run in CI.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), with Rallly's workspace running:
1. Click **Code** and open `apps/web/src/features/poll/mutations.ts` (or press ⌘K, type `createpoll`, Enter).
2. Right-click `createPoll` (line 98). A menu opens at the pointer: Go to definition, Find references, Callers, Callees.
3. Choose **Callers**. The right panel opens on **Calls**: two `route.ts (top level)` entries (the private API and v1), each "calls, resolved", with their lines. The first question takes a few seconds.
4. Click one: the Code view opens that route at the call. Under each row, "2 places" links to the other call.
5. Switch to **Callees**: the project's functions (`assertOpenPollCapacity`, `nanoid`…), then **Unresolved (2)** (Prisma's client isn't generated, explained), then **Built-in (1)**, collapsed.
6. Back in `mutations.ts`, put the cursor on `createPoll` and press **Shift+F12** for its references, or **F12** on any call to jump to its definition. Some browsers keep F12 for their developer tools; the menu always works.
7. Compare with your own reading of the code, as the Try it asks.

**On staging** (after the merge): the Code view says to open the workspace (workspaces run locally for now). What's new shows 0.9.0.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 971 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 20 (1 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 148: 60 catalogue stories and 14 screens, each in both themes (18 new) | `pnpm test:visual` |
| Docker (real containers) | 54 (1 new; the corpus test now also checks the 20 functions) | `pnpm test:docker` |
| Performance | 2, unchanged | `pnpm test:perf` |
| Bundle | 8 budgets, all within | `pnpm size` |

**Bundle (gzip):**

| Part | Size | Budget | Loads |
| --- | --- | --- | --- |
| First load | 149.1 kB | 160 | Every page (+0.6 kB: this phase's CHANGELOG entry, in What's new) |
| Project page | 100.6 kB | 110 | With a project (+4.3 kB: the menu, the inspector's tabs, the Calls panel) |
| Editor core, languages, file tree, palette | unchanged | | |

**The engine's bundle** grows by TypeScript (about 13 MB beside it, copied into a workspace only when the engine changes).

**Mutation-checked** (each guard removed, its tests fail):
- the six callee fixes above, each separately, and the IIFE rule
- the lib-size exception, and the 1 MB cap itself
- the rule that parameters and locals are unresolved
- late Calls answers dropped
- the status bar's per-file cursor
- the comparison's duplicate detection

**Screens:** `docs/reports/phase-5-figma-differences.md`, with the built menu and Calls tab in `docs/reports/phase-5/`, beside Figma 06's inspector and screen 27's menu.

## Deviations from plan and why

1. **The Calls tab shows Runs and Changes dimmed** ("Arrives in a later phase") rather than Figma's counts: nothing is shown that the system didn't derive.
2. **The right-click menu has no icons or label row** (Figma's screen 27 is a flow's menu): the Code view's menu is about the name under the pointer.
3. **Calls the compiler resolves but its call hierarchy can't model** are listed by a rule of our own (resolved for built-ins, module-level constants and members; unresolved for parameters and locals). The plan says "type-resolved call edges"; this keeps every listed edge either proven or honestly unresolved.

## Decision records added

- 0026 TypeScript semantics: the language service in a capped worker, per-tsconfig programs, resolving without `node_modules`, provenance; addendum with the corpus check's fixes and the DOM library's cost.

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **Prisma's client isn't generated** (no installs, decision 2), so its calls are unresolved, and the panel says why.
- **Browsers may keep F12** for developer tools; the right-click menu always works.
- **The first TypeScript question** about a project takes a few seconds (up to about 6 s on Documenso in CI), shown as "Asking TypeScript…".
- **Very large projects** (Twenty) answer from the programs a question needs; making them comfortable is the plan's performance phase (42).
- **Phase 3 bug found and fixed this phase:** the status bar kept the previous file's line after switching files.

**Upgrade-later review at phase end:** nothing new deferred. **3** (TypeScript 7) re-checked on 12 Nov 2026: still not met. **33** unchanged. None of the rest is due.

## CI

The draft PR (#19) ran CI on every push.
- **Milestone A** was green on its last commit (`5a5efbe`), after a phase 4 page test made independent of the machine's speed.
- **Milestone B's pushes** failed, in turn:
  - the visual check for missing baselines (step 6 made them)
  - a new web test past Vitest's 5 s limit on CI's busy runner (5.3 s; its setup is now 3–4 times faster)
  - the walkthrough's selector for editor tabs (buttons, not tabs), which then found the status-bar bug

  Each was investigated to its cause and fixed.
- **Closing commit:** see the PR's checks; the milestone is reported only with every job green.

## Next phase preview

**Phase 6, the graph model** (stage 1 begins; two forks join the corpus, Inbox Zero and Twenty):
- **Build:** the core vocabulary (entry point, code unit, call, decision, data access, async hand-off, external boundary); provenance on every edge; change state on every node; versioned snapshots in SQLite
- **Done when:** the schema handles all 4 forks; snapshot save and load under 1 s
- **Try it:** Labs → Graph stats shows node and edge counts for each demo fork
- This phase's resolved and unresolved calls are the first edges it stores.
