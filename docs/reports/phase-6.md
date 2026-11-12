# Phase 6 — Graph model: report

- Version: `0.10.0`
- Branch: `phase/6-graph-model`; PR #20
- Dates: 12 Nov 2026
- Status: **accepted** by the owner on 12 Nov 2026. Merged in PR #20.

## From the build plan

- **Build:** core vocabulary: entry point, code unit, call, decision, data access, async hand-off, external boundary; provenance on every edge; change state on every node; versioned snapshots in SQLite.
- **Done when:** schema handles all 4 forks; snapshot save and load under 1 s.
- **Try it:** Labs → Graph stats shows node and edge counts for each demo fork.

**Owner decisions** (decisions log, 12 Nov 2026):
1. **The four forks held:** Rallly, Documenso, LibreChat (in Inbox Zero's place, 29 Oct) and Twenty. Excalidraw and Medusa are measured and reported.
2. **Kinds not detected yet** show 0 with the phase they arrive in.
3. **Built-ins stay out of the graph,** counted apart.
4. **Graph stats** is in the inspector's Details tab, behind its Labs switch.
5. **Whatever the site shows that arrives later says so, naming the phase** (asked during the phase, applied everywhere).

**Settled by the documents** (applied):
- **Edge provenance** uses CLAUDE.md's five; phase 5's *unresolved* is stored as *unknown*.
- **Change state** uses the research report's five, plus *analysing*.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| Core vocabulary | ✅ | `@flowcanvas/graph-model`: six node kinds (entry point, code unit, decision, data access, async hand-off, external boundary) and five edge kinds (call, branch, data, hand-off, boundary); ADR 0027 §3 |
| Provenance on every edge | ✅ | Every edge has one of observed, resolved, convention, suggested, unknown; validation refuses an edge without one, an unknown edge that reaches a node, or one without the call's text |
| Change state on every node | ✅ | Added, modified, removed, possibly affected, unchanged, analysing; a diff between two versions sets them (moved code is modified, not removed and added) |
| Versioned snapshots in SQLite | ✅ | A store of its own beside the index: each version named by the SHA-256 of its canonical encoding, gzipped, the last 20 kept |
| **Done when:** schema handles all 4 forks | ✅ | Each fork's graph built in a real workspace, stored, copied out and decoded against the schema; complete for all four; and 26 hand-labelled functions found with exactly their callers and callees |
| **Done when:** save and load under 1 s | ✅ **at most 143 ms to save, 454 ms to load** (Twenty) | `corpus.docker.test.ts` on CI, every version loaded straight back to time it |
| **Try it** | ✅ recorded | `e2e/try-it/phase-6.spec.ts`: Labs → Graph stats on, the project opened, the counts read |

**The forks in real workspaces** (CI run 43230077468, `2c8a177`, 2 CPUs and 4 GiB each):

| Fork | Nodes | Edges | Graph built | Save | Load | Labels |
| --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | 3,327 | 16,394 | 16 s | 15 ms | 37 ms | 10 of 10 |
| **Documenso** | 4,912 | 35,307 | 23 s | 14 ms | 62 ms | 10 of 10 |
| **LibreChat** | 34,488 | 164,991 | 40 s | 97 ms | 327 ms | 3 of 3 |
| **Twenty** | 61,810 | 237,263 | 68 s | 143 ms | 454 ms | 3 of 3 |
| Excalidraw | 4,747 | 16,232 | 14 s | 10 ms | 34 ms | — |
| Medusa | 21,991 | 87,703 | 44 s | 45 ms | 150 ms | — |

Every graph was complete, and the counts are identical to the laptop's: the pass is deterministic.

**What the graph holds today:** code units (functions, methods, components, classes, a file's top level) and calls between them, each resolved by the compiler or unknown with the call's text. More than half the edges are unknown, mostly calls into packages that aren't installed (React hooks, Prisma, lodash). That's honest; framework connectors (phases 8–11) turn the important ones into entry points, data access, boundaries and hand-offs.

Like phases 1d to 5, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthroughs use a fake workspace that answers like the engine. The real engine is proven by the Docker tests, which run in CI.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173):
1. On the home page, open **Labs** and turn on **Graph stats** ("Finished in phase 7").
2. Open Rallly and start its workspace. The inspector's **Details** tab says "Building the graph…" while the engine builds it, after indexing (a few seconds for Rallly; about a minute for Twenty).
3. Read the graph: "3,327 nodes · 16,394 edges", every kind listed (entry points 0, "arrives in phase 8"), how edges are known (resolved 7,514, unknown 8,880), 3,930 calls into TypeScript's library counted apart, and how long it took to build, save and load.
4. Edit a file and save: within a few seconds the graph is brought up to date (only the changed file and those calling into it are walked again).
5. Also new: the left panel, canvas, inspector and review bar say which phase each missing part arrives in.

**On staging** (after the merge): the Labs switch is there; the Details tab says to open the workspace (workspaces run locally for now). What's new shows 0.10.0.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 1,014 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 21 (1 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 162: 66 catalogue stories and 15 screens, each in both themes (14 new) | `pnpm test:visual` |
| Docker (real containers) | 54 (the corpus test now also builds each fork's graph) | `pnpm test:docker` |
| Performance | 2, unchanged | `pnpm test:perf` |
| Bundle | 8 budgets, all within | `pnpm size` |

**Bundle (gzip):** first load 149.7 kB of 160 (+0.5 kB: this phase's CHANGELOG entry, in What's new); project page 102.7 kB of 110 (+2.1 kB: Graph stats); the rest unchanged.

**Mutation-checked** (each guard removed, its tests fail):
- graph model: canonical order; a changed call modifying its caller; unknown edges never reaching a node
- the pass: dependents walked again; starting again on a structural change; built-ins kept out; HTML tags not calls; inferred programs; programs released after the pass
- the engine: one pass at a time; the protocol's exact keys; a version stored once

**Screens:** `docs/reports/phase-6-figma-differences.md`, with the built Graph stats in `docs/reports/phase-6/`.

## Deviations from plan and why

1. **Inferred programs** (not in the plan): files no `tsconfig.json` includes now get a program, as in TypeScript's own editors. LibreChat's whole Express backend (1,342 files) and 983 of Twenty's were invisible to the graph and to phase 5's Calls tab (ADR 0027 §2).
2. **Snapshots are one compact blob per version,** not a row per node and edge: rows took 749 ms to load Twenty on the laptop, too close to 1 s (ADR 0027 §5).
3. **Graph stats' Labs switch says "Finished in phase 7"** (Claude's choice, left to Claude by the owner): the flow builder draws the graph itself. The canvas stress test's switch moved from phase 2 (accepted) to phase 42, the performance phase that finishes large canvases.
5. **A check that texts about what arrives later stay true** (`apps/web/src/later-phases.test.ts`, owner's request): a catalogue example had shown the Code view as "arriving in a later phase" since phase 2, though it shipped in phase 3. The visual tests compared it with its approved screenshot, so they proved it hadn't changed, not that it was still true. The check reads every visible text in the site and the catalogue (with TypeScript's parser) and fails on "later" without a phase, "arrives" without one, or a phase STATUS.md marks accepted. It caught the stress test's stale "phase 2" on its first run, and the original example when put back (mutation-checked).
4. **The empty-state texts were reworded** with their phases (owner, 12 Nov 2026), which changed every project screen's baseline (each diff checked to lie only in the changed texts).

## Decision records added

- 0027 the graph model: code units and call edges from one TypeScript pass, inferred programs, identity by file and qualified name, snapshots as compact blobs (with the spike's measurements, and an addendum on what building it found).

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **TypeScript's references don't follow CommonJS shorthand exports** (`module.exports = { slug }`), so phase 5's Callers misses those callers in LibreChat's backend; the graph has them. Answering Callers from the graph belongs with the flow phases (ADR 0027 addendum).
- **Twenty's graph takes about a minute** to build in a workspace (68 s on CI) and uses up to about 1.9 GB of the worker's 2.5 GB; the pass says "partial" rather than running out. Making large projects faster is the plan's performance phase (42).
- **Most edges are unknown** until the framework connectors (phases 8–11).

**Upgrade-later review at phase end:** nothing new deferred. **3** (TypeScript 7) unchanged since 12 Nov. **33** unchanged. None of the rest is due.

## CI

The draft PR (#20) ran CI on every push.
- **Milestone A** was green on its last commit (`b91c8e5`), including the real-Docker job with the engine carrying the graph pass.
- **The proof commit** (`2c8a177`): every job green, with the corpus numbers above.
- **Closing commit:** every job green (see the PR's checks).
- **After acceptance, one walkthrough failed on a docs-only commit** (`ffa1a5f`, run 43271058049), investigated: the page was the previous build (`8a265b9`). The readiness check had seen the new commit once, but Cloudflare's servers hadn't all switched yet, so the browser's next requests got the old build. The check now needs the commit served 5 times in a row, 5 s apart (`e2e/scripts/wait-for-deploy.ts`; about 25 s per run).

## Next phase preview

**Phase 7, the flow builder and inspector:**
- **Build:** a downstream flow from any function; ELK layout; click a node to open its code; conditions on branches; the node inspector showing every detail the code reveals
- **Done when:** flows for 10 functions render correctly and every node opens the right line
- **Try it:** pick any function in Documenso, open its flow, click nodes and read the inspector
