# Phase 7 — Flow builder and inspector: report

- Version: `0.11.0`
- Branch: `phase/7-flow-builder`; PR #21
- Dates: 12 to 14 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

- **Build:** build a downstream flow from any function; ELK layout; click a node to open its code; conditions on branches; node inspector showing every detail the code reveals (see "What every node shows").
- **Done when:** flows for 10 functions render correctly and every node opens the right line.
- **Try it:** pick any function in Documenso, open its flow, click nodes and read the inspector; compare with Figma 06.

**Owner decisions** (decisions log, 12 and 13 Nov 2026):
1. **Flows open from three places:** the right-click menu, ⌘K and the Calls tab.
2. **Up to 60 nodes,** then a stub saying how many more.
3. **One grouped stub per node** for its unknown calls.
4. **Ten Documenso functions,** labelled by Claude by reading the code.
5. **Compute once, store, reuse** (13 Nov): what a person would wait for is worked out ahead and stored, keyed so it's never stale (ADR 0029).
6. **One shared fake workspace** for walkthroughs and page tests, changing nothing they prove (12 Nov, done in this phase).
7. **Docs held to the code** (13 Nov): `pnpm docs:check` on CI, and the milestone gate `pnpm docs:milestone` (CLAUDE.md, working pace 3).
8. **CI** deploys previews and staging itself; the Docker job runs as four parallel jobs (13 Nov).
9. **The start screen is phase 44**; upgrade-later 20 and 24 have new triggers (13 Nov).

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| A downstream flow from any function | ✅ | `buildFlow` (graph model), from a function's name or from anywhere inside it; breadth-first to 60 nodes, then a stub with the count |
| ELK layout | ✅ | Layered, top to bottom (Figma 06), in a Web Worker; edges drawn along ELK's routes; median 56 ms for 60 nodes (`layout.perf.test.ts`) |
| Click a node to open its code | ✅ | Open code, or a double-click, opens the Code view at its line (walkthrough: `get-team.ts` at line 38, column 14) |
| Conditions on branches | ✅ | Decisions in the graph (`if`, ternaries, `&&`/`||`/`??`, `switch`, `catch`), drawn as diamonds with their conditions and outcomes |
| Node inspector | ✅ | For a function: signature, inputs, output, async, exported, decisions, throws, awaits, unknown calls, writes to module state; for a decision: its condition and where each outcome leads |
| **Done when:** flows for 10 functions render correctly | ✅ **10 of 10** | `corpus/labels/flows.json`, written by reading the code (261 lines); compared exactly in a real Documenso workspace on CI (run 43484134103); and rendered: the walkthrough and two screens |
| **Done when:** every node opens the right line | ✅ | Every node's file and line is in its label line and matched exactly; every labelled function's flow opens at its own node from its name and from inside it (**20 of 20** in Documenso, 18 of 18 in Rallly); the walkthrough opens a node's code at its line |
| **Try it** | ✅ recorded | `e2e/try-it/phase-7.spec.ts`: Documenso's `deleteFolder` by ⌘K, Show flow, getTeam's details, Open code, a decision's outcomes; compared with Figma 06 in `phase-7-figma-differences.md` |

**In real workspaces on CI** (run 43484134103, `113ffbc`, 2 CPUs and 4 GiB each):

| Fork | Graph | Built | Save | Load | Flows at their node | Labelled flows | Calls from the store |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | 5,381 nodes, 22,574 edges | 19 s | 11 ms | 25 ms | 18 of 18 (≤ 30 ms) | — | 10 of 10 (≤ 54 ms) |
| **Documenso** | 9,861 nodes, 50,094 edges | 27 s | 17 ms | 49 ms | 20 of 20 (≤ 19 ms) | **10 of 10** | 10 of 10 (≤ 19 ms) |
| **LibreChat** | 62,344 nodes, 233,966 edges | 49 s | 84 ms | 184 ms | 6 of 6 (≤ 18 ms) | — | — |
| **Twenty** | 95,954 nodes, 321,601 edges | 87 s | 140 ms | 255 ms | 6 of 6 (≤ 16 ms) | — | — |
| Excalidraw | 9,209 nodes, 28,119 edges | 17 s | 12 ms | 34 ms | — | — | — |
| Medusa | 32,807 nodes, 114,844 edges | 44 s | 35 ms | 80 ms | — | — | — |

The graphs are larger than phase 6's because decisions are now nodes. Details answered in at most 18 ms.

Like phases 1d to 6, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthrough uses the shared fake workspace, answering with the engine's own flow and details for `deleteFolder`; the engine is proven in real workspaces by the Docker tests.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173):
1. Create a project with Documenso's corpus fork (`https://github.com/ArmaanAhuja-7777/documenso`; its pin is in `corpus/manifest.json`) and start its workspace. Wait for the graph (about half a minute).
2. Press ⌘K, type `deleteFolder`, and choose **Show the flow from deleteFolder**. Or open `packages/lib/server-only/folder/delete-folder.ts` in the Code view and right-click `deleteFolder` → **Show flow**; or use **Show flow** in the Calls tab.
3. Read the canvas: `getTeamById` and `getTeam` below it, the decisions `!folder` and `!hasPermission` leading to `AppError` on "yes", the stub "2 unknown calls" (Prisma's client), and "13 edges · 10 resolved · 3 unknown" at the top left.
4. Click **getTeam**: the inspector shows its signature, its three decisions, what it throws and awaits, and its unknown call. **Open code** opens `get-team.ts` at line 38.
5. Click a decision: its condition and where each outcome leads.

**On staging** (after the merge): What's new shows 0.11.0; flows need a workspace, so they work locally only for now.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 1,131 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 22 (1 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 186: 76 catalogue stories and 17 screens, each in both themes (4 new screenshots, 6 updated) | `pnpm test:visual` |
| Docker (real containers) | 49 (the corpus test now also compares 10 labelled flows); on CI as four parallel jobs | `pnpm test:docker` |
| Performance | 3: canvas, search, and a 60-node flow's layout (median 56 ms) | `pnpm test:perf` |
| Bundle | 9 budgets, all within | `pnpm size` |

**Bundle (gzip):** first load 150.7 kB of 160 (+1.0 kB: What's new); the project page 108.9 kB of 110 (+6.2 kB: flows and the inspector; close to its budget, see known issues); ELK in its own chunk, 443.9 kB of 490, loaded the first time a flow opens.

**Mutation-checked** (each guard removed, its tests fail; run on 14 Nov 2026): the pass marking guarded lines (1 engine test fails); the flow builder using them (3 flow tests fail); the stored facts' hash check (a file edited after its facts were stored is answered from them: 1 test fails); the shared fake's flow route (the 2 page tests that open flows fail). The new docs checks each have tests of the finding they must make and of the case they must leave alone.

**Screens:** `docs/reports/phase-7-figma-differences.md`, with the built screens in `docs/reports/phase-7/`.

## Deviations from plan and why

1. **Compute once, store, reuse** (owner, 13 Nov; ADR 0029): each file's functions, details and calls are stored by the graph pass in `facts.db`, so flows from inside a function, details and the Calls tab answer from it instead of asking TypeScript again (Calls: 2.9 ms against 7.8 ms on Rallly, 48 ms against 556 ms on Documenso; 705 of 710 answers identical to TypeScript's, the rest TypeScript's own quirks).
2. **Graph format 3** (not planned): the labels found that a call which always happens was hidden when a guarded call to the same function shared its line. The pass now records which lines of a call are fully guarded; stored versions are rebuilt once.
3. **Edges follow ELK's routes, and nodes are as tall as they render** (ADR 0028 addendum): found on the first screens of a real flow, where edges ran behind nodes and names broke mid-word.
4. **The docs are held to the code** (owner, 13 Nov): `pnpm docs:check` on every push, and the milestone gate before every report. It found ARCHITECTURE dated "end of phase 1b", 11 commits not written up, and stale upgrade-later triggers; all fixed.
5. **CI** (owner, 13 Nov): previews deployed by CI (Cloudflare's GitHub app had dropped two pushes); the Docker job in four parallel jobs (9 minutes to 4); a timing test's sample made big enough for its statistic.
6. **One shared fake workspace** (owner, 12 Nov) for the walkthroughs of phases 3 to 7, the screens and five page tests: every test passes unchanged, 199 web tests before and after.

## Decision records added

- 0028 flows: decisions as nodes, flows from the latest version, details, ELK in a Web Worker (with addenda: the engine's facts and timings, and drawing what ELK laid out).
- 0029 compute once, store, reuse (with the Calls tab's addendum).
- 0005 addendum: deploys from CI.

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **The project page's chunk is at 108.9 of its 110 kB budget.** The next phase's page additions will need room: splitting the inspector's details into a lazy chunk is the likely next step.
- **Node heights are estimated** from the fonts' character widths, erring tall; a font change would need the estimate checked (a test compares the estimate with the node's rules, not with a browser's measurement).
- **Most unknown calls are packages** (Prisma's client, Node's own modules), since the corpus workspaces don't install dependencies; framework connectors (phases 8 to 11) make the important ones real nodes.
- **Expanding, collapsing and filtering a flow,** and per-call unknown stubs, are phase 12; the canvas says so.

**Upgrade-later review at phase end:** 7 checked (a shared CI cache would save seconds; new trigger); 10 rewritten (fork previews); 17 checked; 20 and 24 given new triggers by the owner; 23's trigger was reached on 31 Oct and is a question below; 46 added (a CPU share of its own for analysis).

## Questions for the owner

1. **Opening a flow:** fit the whole flow to the canvas (now: 53% for `deleteFolder`, text small), or open at 100% on the function you chose, with **F** to fit? Figma 06 shows 100%. Recommendation: 100% on the chosen function, since it's what you asked to see, and F is one key away.
2. **Migrate staging's database from CI** (upgrade-later 23): it needs the production database's address as a GitHub Actions secret. Recommendation: not yet, while migrations are rare and you run them; do it before any external user's data is stored.
3. **CI's report step** downloads the walkthroughs' 59 MB of recordings from GitHub (3 minutes, after every test has finished). Recommendation: let the walkthroughs job publish its own recordings to the reports Worker, saving about 3 minutes a push.

## CI

The draft PR (#21) ran CI on every push.
- **Milestone A** (steps 0 to 3) was green on its last commit.
- **Milestone B** (steps 4 to 6, 6a and 6b) was green on `5f6fdd6`, and again on each commit since; red runs were fixed first (a timing test's sample, `fff9bd0`).
- **The proof** (`113ffbc`): Documenso's 10 labelled flows 10 of 10 in a real workspace.
- **One red run at the close** (`012350f`): the screen test caught the canvas saying "Choose a function to see its flow" for one render under a flow just laid out. Fixed at its cause (`181d09d`), not by loosening the test.
- **Closing commit:** every job green, and the milestone gate passing (see the PR's checks).

## Next phase preview

**Phase 8, entry-point detection:**
- **Build:** detect React event props, pages and routes, Next.js server actions and API routes, Express routes, package.json scripts; the entry points panel
- **Done when:** at least 90% of hand-listed entry points found across the 4 forks
- **Try it:** the left panel lists screens, routes, jobs and events (Figma 06); click each to open its flow
