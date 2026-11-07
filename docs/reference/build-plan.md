# Build Plan: Canvas-First AI-Native IDE

Oct 13, 2026 · @Manan

**This plan builds the product in 96 small phases across 10 stages. Every stage ends with software that runs and does something useful, and the final phase leaves the complete canvas-first IDE described in the research report.** Web apps get full support first (stages 0–6). Every other kind of software follows, one category at a time, tested on forked GitHub repos (stages 7–8). Then come team and platform features (stage 9).

> **Owner amendments** (details and dates in `docs/decisions-log.md`):
> - **Colours:** the Signal palette replaces the muted palette (28 Oct 2026).
> - **No automated Figma comparison:** Figma is a visual reference reviewed by eye, and visual tests compare against our own approved baselines (29 Oct 2026).
> - **Test corpus:** six varied repos from phase 1b onward instead of two: Rallly, Documenso, LibreChat (replacing Inbox Zero, whose licence restricts commercial use), Twenty, Excalidraw and Medusa, as public forks pinned in `corpus/manifest.json` (29 Oct 2026).
> - **"Open demo project":** the button moves from 1b to 1d (29 Oct 2026).

## How this plan works

**Phase size.** Each phase is scoped to about 1–2 weeks for a team of 2–3 engineers, working with AI agents. Most phases can be split in half if a week runs short. Nothing in a phase depends on a later phase.

**Lettered phases.** Fifteen phases (1a, 1b, 1c, 1d, 18a, 20a, 22a, 27a, 27b, 27c, 31a, 36a, 42a, 44a, 48a) were added after the first draft for the design system, the see-and-test harness, cloud workspaces, backups, direct editing, prompting from anywhere, model choice, settings, plans and the local runner. Each sits right after the numbered phase it depends on, so the original numbering stays stable.

**Where the code runs (decided).** First users are individual developers and startups, so the product is a web app and every project runs in an isolated cloud workspace with autosave, backups and sleep when idle. A local runner (phase 48a) adds the option of running on the user's own machine before the waves that need it.

**Phase format.** Every phase lists what to **build** and a **done when** test you can actually run. A phase is not finished until its test passes on the forked test repos.

**Rules for every phase:**

- **Always shippable.** The app must start and work at the end of every phase; no long-lived broken branches.
- **Test on forks.** Each phase is checked against the forked repo corpus for its stage, Test repos are always fully built, actively maintained public open-source projects, never the team's or a customer's own product.
- **Regression suite.** Every completed check joins an automated suite that runs on every commit; nothing that passed may break later.
- **Provenance first.** No feature may draw a connection without a provenance tag (observed, resolved, convention, suggested, unknown).
- **Safe by default.** Every project runs in its own isolated workspace; `.env` files and secrets are never indexed, logged or sent to a model; telemetry is off by default.
- **Dogfood.** From stage 5 on, the team builds the product inside itself.

**Already decided (from the research and design work):** canvas is the main surface; web apps (TypeScript full stack) first; wrap existing agents (Claude Code, Codex) instead of building one; agents get full context by default with optional selection; one project type at a time, with the user asked what kind of project it is; the Graphite design language with the muted palette, as drawn in Figma screens 01–31.

## See it and test it after every phase

**Every phase ends with something you can open in a browser, click and check yourself, not just code that passed review.** Phase 1b builds the machinery for this, so it works from week 2 onward.

| What you get | When | How you use it |
| --- | --- | --- |
| Preview link | Every merged phase | A staging URL updated on every merge and a preview URL for every pull request; nothing to install |
| "Open demo project" | Every phase | One click opens the forked repos for the current stage, already running in cloud workspaces, so you never set anything up |
| Try-it steps | Every phase | The "Try it" column in each stage table: 2–4 steps you can follow at the preview link to see the new capability |
| Figma comparison | Every phase that adds UI | Each phase names the Figma screens (01–31) it implements; an automated screenshot test compares the app against them |
| Recorded run | Every phase | End-to-end tests drive the app through the try-it steps and save a video in the CI report |
| What's new | Every phase | An in-app panel listing what changed in this build and where to find it |
| Labs | While a feature is unfinished | Settings → Labs switches on half-built features so you can preview them early without them affecting normal use |
| Stage demo | End of every stage | A 15-minute walkthrough in a fresh account using only the preview link and the demo project; the stage's working milestone must be visible |

**Rule:** a phase is not done until its try-it steps work at the preview link in a fresh account that has never opened the project.

## Stage map

&#91;embedded content: stage map · 10 stages, 96 phases (81 numbered + 15 lettered)\]

Each box is a stage; the line under the stage name is what works when it ends. Stages 0–6 deliver a complete IDE for web apps; stages 7–9 extend it to every kind of software and to teams.

## Tech stack

**Use TypeScript almost everywhere, reuse proven open-source parts for every commodity IDE feature, and spend custom effort only on the flow engine, connectors and canvas.** Rust can replace hot paths later if profiling demands it.

| Part | Choice | Why |
| --- | --- | --- |
| App delivery | Web app served from our cloud; optional desktop wrapper later | Zero install; live frames render in the user's own browser; every phase reachable by a link |
| App UI | React + TypeScript | Same language as wave 1 targets; huge component ecosystem |
| Canvas | React Flow (xyflow) first, custom WebGL layer for large graphs in stage 6 | Fast start with nodes, edges, pan and zoom; WebGL when graphs get big |
| Graph layout | ELK (elkjs) with pinned positions | Layered layouts for flows; supports incremental, stable layout |
| Code editor | CodeMirror 6 (owner decision 7 Nov 2026, ADR 0021; was Monaco) | Runs under the strict CSP, light enough for many editors on the canvas, colours from our tokens, official diff and language-server packages |
| Language features | Language Server Protocol clients | One integration gives completion, diagnostics and go-to-definition for any language |
| Debugger | Debug Adapter Protocol clients | Same idea as LSP for debuggers; adapters exist for most languages |
| Terminal | xterm.js + node-pty | Standard pairing used by VS Code |
| Parsing | tree-sitter (Node bindings) | Incremental parsing for 100+ languages; basis of Level 1 support |
| TypeScript semantics | TypeScript compiler API | Exact, type-resolved calls for wave 1 |
| Analysis engine | Node process inside each workspace (worker threads) | Keeps the UI responsive; can later be rewritten in Rust piece by piece |
| Storage | SQLite (better-sqlite3), content-hash keyed | One fast store per workspace, included in snapshots |
| Git | Git CLI plus shadow refs for checkpoints | Exact git behaviour; checkpoints without touching the user's branches |
| Agents | Agent Client Protocol client library; Claude Code hooks | One integration for many agents |
| Agent context | MCP server (official TypeScript SDK) | Lets any agent query the flow graph |
| Element-to-source | SWC / Babel dev-only plugin | Stamps JSX elements with file and line |
| Runtime evidence | OpenTelemetry Node SDK; test-runner wrappers (Vitest, Jest, Playwright) | Standard tracing; tests are the cheapest runtime proof |
| Product's own AI | Provider-neutral model gateway (Anthropic, OpenAI, Google, Mistral, local via Ollama, OpenAI-compatible and enterprise endpoints) | Bring-your-own key; no-LLM mode |
| Packaging and CI | GitHub Actions continuous deployment; workspace image builds | Every merge deploys to staging; every pull request gets its own preview URL |
| Workspaces | Lightweight virtual machines (Firecracker-style), from a managed sandbox provider at first, own fleet later | Isolation strong enough for untrusted code and agents; fast snapshot and resume |
| Control plane | TypeScript service with Postgres | Accounts, projects, scheduling and metering in one familiar stack |
| Gateway and previews | WebSocket gateway plus an authenticated reverse proxy | Live sync to the browser and private preview URLs for live frames |
| Backups | S3-compatible object storage plus a private backup git remote | Snapshots, checkpoint backups and restore history |
| Sign-in and billing | GitHub and Google sign-in; usage-based billing (e.g. Stripe) | Standard, quick to integrate, fits startups |
| Secrets | Encrypted vault using cloud key management | Agent keys and env vars never stored in plain text |

## Stage 0: Foundations (phases 1–5)

**Working milestone: a web app that opens a TypeScript repo in a cloud workspace and shows it on a canvas, edits code, and answers "what calls this?".** Test repos: fork Rallly (scheduling polls; Next.js, tRPC, Prisma; small) and Documenso (document signing with PDF uploads and email); they seed the corpus.

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 1. Project skeleton | Monorepo (web app, workspace agent, engine, control plane, shared types); React web app deployed to a staging URL; CI with lint, type checks and tests | The staging URL loads the app; every pull request gets its own preview URL | Open the staging link; the app loads and shows its version |
| 1a. Design system in code | Graphite tokens (muted palette, Slate scale, text styles, radii, spacing) generated from the Figma variables into CSS variables; base components: Button, Tag, Input, Toggle, Menu, Tooltip, Tabs, Panel, Flow node, in dark and light; component catalogue (Storybook) | Each component matches its Figma counterpart in a side-by-side screenshot test | Open the component catalogue from the CI report, flip dark and light, compare with the Figma Components page |
| 1b. See-and-test harness | Staging and per-PR preview URLs; "Open demo project" that starts the current stage's forks in workspaces; end-to-end tests that drive the browser app and record video; screenshot comparison against Figma exports; What's new; Labs switches | Every merged phase produces a link, a test report and a recording without manual steps | Open the preview link, click Open demo project, watch the recording in the CI report |
| 1c. Sign-in and control plane | GitHub and Google sign-in; projects list; workspace records; secrets vault; usage metering skeleton; admin view | A new user signs in, creates a project and sees it listed; saved secrets never appear in logs | Sign in with GitHub, create a project, add a secret, confirm the logs show no value |
| 1d. Workspace sandbox | One isolated virtual machine per project; clone a repo; file and process API; terminal in the browser; outbound network rules; resource limits; sleep when idle and resume | A fork clones and opens in under 60 s; a workspace sleeps after 10 idle minutes and resumes intact; workspaces can't reach each other | Open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume |
| 2. Canvas and app shell | React Flow canvas with pan, zoom, minimap, selection; the app shell from Figma 06 (top bar, rail, side panels, review bar) with placeholder content; panels that dock and collapse | 500 dummy nodes pan and zoom smoothly; layout matches Figma 06 | Pan, zoom and collapse panels; compare with Figma 06 |
| 3. Open a repo and edit | CodeMirror 6 in the browser (was Monaco; ADR 0021) with the buffer synced to the workspace; tabs, save, undo, quick-open; autosave journal every few seconds; file watcher | Edits survive closing the tab and reopening; an edit made in the terminal appears in the editor | Edit a file in Rallly, close the tab, reopen it: the change is still there |
| 4. Indexer | Engine inside the workspace; tree-sitter parse of every file; symbols into SQLite; symbol search; re-index changed files on save | Both forks index in under 30 s; symbol search under 100 ms | Press ⌘K and jump to any function in Rallly |
| 5. TypeScript semantics | TypeScript compiler API service: definitions, references, type-resolved call edges; callers and callees panel | Callers and callees for 20 hand-picked functions match a manual check | Right-click a function → Callers; compare with your own reading of the code |

## Stage 1: Static flows on the canvas (phases 6–13)

**Working milestone: pick any button, page, route or job in a web app and see its full flow, from click to database and background work, built from the code with every edge tagged.** Add 2 forks: Inbox Zero (email app with AI features and auth) and Twenty (large CRM with a NestJS back end, GraphQL and BullMQ background jobs).

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 6. Graph model | Core vocabulary: entry point, code unit, call, decision, data access, async hand-off, external boundary; provenance on every edge; change state on every node; versioned snapshots in SQLite | Schema handles all 4 forks; snapshot save and load under 1 s | Labs → Graph stats shows node and edge counts for each demo fork |
| 7. Flow builder and inspector | Build a downstream flow from any function; ELK layout; click a node to open its code; conditions on branches; node inspector showing every detail the code reveals (see "What every node shows") | Flows for 10 functions render correctly and every node opens the right line | Pick any function in Documenso, open its flow, click nodes and read the inspector; compare with Figma 06 |
| 8. Entry-point detection | Detect React event props, pages and routes, Next.js server actions and API routes, Express routes, package.json scripts; entry-points panel | At least 90% of hand-listed entry points found across the 4 forks | Left panel lists screens, routes, jobs and events (Figma 06); click each to open its flow |
| 9. UI → API connector | Link `fetch`, axios, tRPC and server-action calls to their route handlers by URL, method and params | A form submit's flow crosses into the right handler in all 4 forks | In Rallly, open the "Create poll" submit; the flow continues into the API handler |
| 10. Data and external connectors | Prisma and raw SQL as data-access nodes; third-party SDK calls (payments, email, storage) as external boundaries | Reads and writes show table names; email and payment calls show as boundaries | In Documenso, open "Send document"; see the database writes and the email boundary |
| 11. Async connectors | BullMQ queues and workers, cron, event emitters, WebSockets, timers; drawn as hand-offs to a background lane | A "send email" flow shows enqueue → queue → worker → result | In Twenty, open a job flow and see the background lane |
| 12. Progressive disclosure | Semantic grouping, expand and collapse, *unknown* stubs, completeness pill per flow, pinned positions | A 60-node flow opens as 8 or fewer groups; expanding one moves no other node | Open Twenty's largest flow; expand a group; read the completeness pill |
| 13. Sequence view | Timeline of the same flow: order, async hops, retries, failure paths; Graph / Sequence switch | Same flow reads correctly in both views | Switch to Sequence on any flow; compare with Figma 08 |

### What every node shows

**Selecting any node opens an inspector with everything a developer needs to understand that step, and lets them edit it in place.** Static details come from the code in this stage; runtime values are added in stage 4 (phases 29–30). Each connector built in any wave must fill in the inspector for its node types. Every value is tagged with where it came from, and every in-place edit goes through the normal checkpoint and behavioural diff.

| Node type | From the code | From real runs | Edit in place |
| --- | --- | --- | --- |
| UI element | Component, props, state it reads, event handlers, styles, accessibility attributes | Rendered values, re-renders | Text, props, styles |
| Function or handler | Signature, input and output types, branches and conditions, side effects, callers | Argument and return values, duration | Code |
| API call and route | Method, URL, params, request and response shape, auth required, middleware | Actual request and response, status, latency | Route code and schema |
| Validation or business rule | Rules and error messages | Which rule passed or failed | Rule |
| Data access | Query (ORM or SQL), tables and columns, read or write, transactions | Rows returned or changed, query time | Query |
| External service | Endpoint or SDK method, env var names it needs, retries, timeouts | Payloads, responses, errors | Settings |
| AI or LLM call | Prompt template, model, parameters, inputs, expected output format, parsing | Filled-in prompt, response, tokens, cost, latency | Prompt and parameters; re-run on a saved input |
| Queue, job or cron | Queue name, payload shape, retries, schedule, concurrency | Job runs, failures, durations | Schedule and retry policy |
| Config and feature flags | Which env vars and flags affect this flow, and which branch each selects | Current values (secrets masked) | Non-secret values |
| Auth and permissions | Required roles, guards, middleware | Which user and role ran it | Rules |
| Errors | Thrown errors, catch handlers, fallbacks | Actual exceptions and stack traces | Handling code |
| Files and storage | Allowed types, size limits, storage path, transforms | File sizes, paths, processing time | Limits and paths |

The table is the minimum, not a ceiling: if a detail is in the code and affects behaviour, the inspector should surface it.

## Stage 2: Live UI frames (phases 14–18)

**Working milestone: the app runs on the canvas as live screens laid out like Figma frames; click any element to jump to its code and open its flow.** Add a real-time fork: Excalidraw (collaborative whiteboard).

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 14. Run manager and terminal | Detect dev, build and test scripts; start and stop processes; integrated terminal; logs; prompt for missing env vars without indexing secrets | All forks start from one button; a missing `DATABASE_URL` shows a clear prompt | Start Rallly from the run button; see process cards and terminal output (Figma 12) |
| 15. Live frames | Each route served through the private preview proxy and shown as an artboard; device sizes; arrange, resize, reload; frames stay interactive | 10 routes visible at once and clickable; frames survive pan and zoom | See Rallly's screens as frames and click through them |
| 16. Element-to-source | Dev-only SWC / Babel plugin stamps JSX with file, line and component; hover outline; click jumps to code | 95% of clicked elements open the correct line | Hover elements in a frame, click one, check the code that opens |
| 17. Element → flow | Clicking an element starts its flow beside the frame; hovering a node highlights the element | Clicking a submit button opens its full UI → API → DB flow | Click a button in a frame and watch its flow draw beside it (Figma 06) |
| 18. Frame states | Route params, login sessions, seed fixtures, recorded click steps; saved states per frame | Logged-in, empty and error states of 3 screens restore with one click | Switch a frame between saved states from its state chip |
| 18a. Direct edits on live frames | Edit text, props and simple styles of a selected element in the frame or the inspector; written to the stamped source location; structural changes open a prompt with the element attached | Edits on 10 elements across 3 forks land on the right line and hot-reload | Change a button label in a frame, apply, see the reload and the diff (Figma 28) |

## Stage 3: Agents and live change (phases 19–27)

**Working milestone: the full core loop. Ask Claude Code or Codex for a change and watch the live frames and flows update step by step, then see exactly what behaviour changed and roll any step back.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 19. Agent panel | ACP client; Claude Code and Codex inside the product; streamed messages and tool calls; approval cards using the agent's own permissions; full-project context by default | Both agents complete a small feature task in a fork | Ask Claude Code for a small change in a demo fork and approve its command (Figma 07) |
| 20. Change capture | A checkpoint per agent write (shadow git refs); intent stored per step; Claude Code hooks; file watcher for your own edits | A 10-step session yields 10 restorable checkpoints | Open the checkpoint list after a session and restore step 2 |
| 20a. Backups and restore history | Every checkpoint pushed to a private backup remote; scheduled workspace snapshots plus one on every sleep; a restore history page; restore a file, a step or the whole workspace | Deleting a workspace and restoring it from backup returns code, checkpoints and canvas layout | Delete a demo workspace, restore it from history, check the canvas comes back as it was |
| 21. Incremental analysis | Re-parse and re-resolve only changed files and their dependents; recompute affected flows; *analysing* state on stale nodes | p90 update under 3 s per step on the largest fork so far | Watch "analysing…" clear after each agent step; the status bar shows the update time |
| 22. Live canvas updates | Change states with animation; removed nodes ghost out; layout pinned; frames hot-reload | A recorded session replays with no layout jumps | Replay the demo session from Labs; nodes appear, change and ghost (Figma 06, 07) |
| 22a. Edit in place and code cards | Inspector fields that map to a literal (prompt, query, config, prop) become editable; double-click a node for a code card; every edit is checkpointed | Edits to a prompt, a query and a config value each update code, flow and diff | Edit a prompt in the inspector, save, then open the new checkpoint and diff |
| 23. Behavioural diff | Session baseline vs current snapshot, scoped to touched flows; before / after compare; code diff behind any node | For 10 seeded changes, exactly the changed flows are marked | Click Compare after a session (Figma 09) |
| 24. Blast radius | Flows and screens outside the view that depend on changed nodes, listed and highlighted | A change to a shared helper surfaces every screen that uses it | Change a shared helper and watch affected frames get the violet outline |
| 25. Optional scope | Select nodes to focus the agent; edits outside the selection flagged, never blocked | Out-of-scope edits flagged in 10 of 10 test sessions | Select 3 nodes, ask for a change that touches another file; see the notice (Figma 07) |
| 26. Accept, reject, revert | Accept or reject per step or session; revert to any checkpoint; canvas and frames follow | Reverting step 4 of 10 restores code, flows and frames exactly | Revert one step of a session and check the canvas rolls back |
| 27. MCP server | Flow graph exposed to agents: callers, flows touching a file, entry points, affected screens | The agent answers "what breaks if I change X?" with the MCP tools on 5 cases | Ask the agent that question; see the flow-graph tool calls in its log |
| 27a. Prompt from a node | Hover actions on nodes; prompt bar anchored to a node or selection with context chips; read-only answers in a popover; "Fix it" turns an answer into a change | From 10 nodes the agent gets the right source, flow and runtime context | Hover a node → Ask; send a question, then a change (Figma 25, 26) |
| 27b. Prompt from anywhere | Prompt from a flow, entry point, event, job, live-frame element, failing test, review item or comment; @node, @flow, @route, @event, @file; "Context that will be sent" list with token estimate; secrets masked | Each of the 8 starting points attaches the right context; no secret in any pack | Right-click an event → Ask about this flow; check the context list; try an @ mention (Figma 27, 29) |
| 27c. Agent and model picker | Choose agent per session; pass through the models and modes each agent offers; sign-in state per agent | Switching agent or model mid-project keeps canvas state and history | Switch from Claude Code to Codex and change model in the composer (Figma 30) |

## Stage 4: Verification and evidence (phases 28–32)

**Working milestone: every agent session ends with a trustworthy report of what changed, what might be affected, what was tested, what was observed running, and what is still unverified.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 28. Test mapping | Discover tests (Vitest, Jest, Playwright); map tests to nodes via coverage; relevant tests for changed nodes; one-click runs with results on the canvas | Relevant tests for 10 seeded changes match a manual check | Change code, open the Tests panel, run the related tests (Figma 15) |
| 29. Test-run tracing | Instrument test runs to record real calls; turn them into *observed* edges | At least 30% of edges in tested forks become observed | Run tests, then see check marks appear on edges |
| 30. Dev-server tracing | Opt-in tracing on the dev server; clicks in frames light up the path; real values (payloads, filled-in prompts, query results, timings, errors) in the inspector's Runs tab, masked by default | Clicking a button highlights the executed path within 2 s | Turn on tracing, click through a frame, open a node's Runs tab |
| 31. LLM labeller | Readable names and summaries; *suggested* edges drawn dotted and opt-in; no-LLM mode; repo text treated as data, never instructions | No suggested edge is ever drawn solid; app works fully with AI off | Toggle AI labels in Settings and watch names and dotted edges change |
| 31a. Model gateway | Provider-neutral layer: Anthropic, OpenAI, Google, Mistral, Ollama and LM Studio (on the local runner or a self-hosted server), any OpenAI-compatible URL, Bedrock, Vertex, Azure; keys in the secrets vault; per-task routing; self-hosted-only mode; usage and cost per task; fallback model | Labels, explanations and search each run on a different chosen provider; self-hosted-only mode sends nothing to third-party providers | Settings → Models: connect a provider and a self-hosted model, route tasks, check usage (Figma 31) |
| 32. Review panel and session report | Changed, possibly affected, tests, observed, unverified; session report page with request, steps, diff summary and unverified items; Markdown export | A reviewer finds a seeded side effect faster than with a file diff alone | Finish a session, expand the review bar (Figma 10), open the session report (Figma 21) |

## Stage 5: Daily IDE essentials (phases 33–39)

**Working milestone: a developer can do a full working day in the product without opening another IDE, open any web repo from a URL, or start a new app from scratch.** From here the team builds the product inside itself.

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 33. Language intelligence | Language servers in the editor: completion, diagnostics, hover, go-to-definition, references, rename; project-wide search and replace | Parity with VS Code for TypeScript on a 15-action checklist | Work through the checklist in a demo fork (Figma 11) |
| 34. Git panel | Status, staging, commit, branches, conflict resolution, history, push and pull; checkpoint timeline beside commits | The team does all its git work in the product for a week | Commit and push a change from the product (Figma 13) |
| 35. Debugger | Debug adapters for Node and browser; breakpoints, stepping, variables, call stack; paused node highlighted on the canvas | Debug a seeded bug end to end with the paused node highlighted | Set a breakpoint on a node and step through it (Figma 14) |
| 36. Workspace UX | Command palette, VS Code-compatible keybindings, dark and light themes, saved canvas views, multiple open projects | New users find 10 core commands without help | Press ⌘K and run commands; switch theme (Figma 16) |
| 36a. Settings and profile | Settings pages: privacy and runtime, agents, editor and keys, project, appearance, notifications; profile with display name, connected agents, model keys and workspace usage | Every setting persists across sessions and devices and changes behaviour; keys live only in the secrets vault and never appear in logs | Turn off payload capture and confirm traces hide values; check the profile page (Figma 17, 18) |
| 37. Open existing repos | Clone from a URL or upload a folder into a new workspace; type detection with confirmation; dependency install inside the workspace; setup checks with agent fixes | 5 unseen public web repos open and show flows with no set-up beyond secrets | Clone a public repo you have never opened (Figma 02, 03, 04) |
| 38. New project from scratch | Describe an app or pick a template; the agent scaffolds; the canvas fills as files appear | A 3-screen app built from one prompt entirely in the product | Describe a small app and watch the canvas fill (Figma 05) |
| 39. Interop and escape hatch | "Open in VS Code or Cursor" through a remote connection to the workspace; edits made there show up instantly; import VS Code settings | Switching to VS Code and back loses no state | Open a file in VS Code, edit, return and see the canvas update |

## Stage 6: Wave 1 hardening and first release (phases 40–45)

**Working milestone: version 1.0 for web apps, available to anyone at a link, with full (Level 3) support for TypeScript full-stack projects.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 40. Wave 1 corpus | Full web corpus: Rallly, Documenso, Inbox Zero, Twenty, Excalidraw, Dub, PhET simulations; 30 hand-labelled flows; benchmark in CI | Benchmark runs nightly with precision, recall and update speed per repo | Open the benchmark dashboard from the CI report |
| 41. Accuracy push | Fix connector and resolver gaps found by the benchmark | Edge recall 85%+ and precision 95%+ | Watch the dashboard trend; open any flagged flow in the nightly |
| 42. Performance | Background indexing, lazy flows, content-hash caches, WebGL renderer with level-of-detail, node caps, memory limits | Large fork indexes in under 5 min; p90 update under 3 s; 2,000 nodes stay smooth | Open Twenty and time it to the first flow; pan a 2,000-node graph |
| 42a. Fast, affordable workspaces | Prebuilt images for common stacks; dependency caches; a warm pool of ready workspaces; sleep tuning; cost tracking per workspace | A typical web repo opens to its first live frame in under 20 s; idle cost per user stays within the agreed budget | Open a fresh fork and time it to the first live frame; check cost per workspace in the admin view |
| 43. Security and privacy | Workspace isolation review, outbound network rules, abuse detection, encrypted volumes, secret redaction, `.env` never indexed, permission prompts for tracing, telemetry off by default | External review finds no open high-severity issue | Put a fake key in `.env` and confirm search, traces and context packs never show it |
| 44. Production readiness | Production deployment of the web app, control plane and workspace fleet; status page; monitoring and alerts; incident runbooks; onboarding tour; docs | A new user goes from sign-up to a running demo project in under 5 min; a simulated outage recovers with no data loss | Sign up with a fresh account and follow the tour |
| 44a. Plans, limits and billing | Free allowance of workspace hours; usage-based individual plan; usage meter and limits on the profile page; spending alerts; a graceful pause at the limit that saves everything | Upgrading, hitting a limit and resuming all work end to end with no lost work | Use up the free allowance on a test account, upgrade, and carry on (Figma 18) |
| 45. Beta and launch | 20 design partners; canvas trial; fix top issues; public beta then 1.0 | 6 of 8 trial developers finish a real task without another IDE | Read release notes; run the stage demo end to end |

## Stage 7: Plugin architecture and support levels (phases 46–48)

**Working milestone: any project in any language opens in the product, at Level 1 or better, and the web support from stage 6 runs as the first plugin.**

| Level | What the developer gets |
| --- | --- |
| 1. Basic | Canvas, code editor, symbol view, syntax-level call graph, terminal, git, agent panel |
| 2. Structural | Type-resolved flows, behavioural diff, relevant tests |
| 3. Full | Live preview, cross-boundary flows, runtime evidence |

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 46. Plugin interface | Five extension points (project detector, entry-point detector, edge resolver, boundary connector, preview adapter) plus a runner; wave 1 web support refactored into a plugin | Web benchmark unchanged after the refactor | Settings → Project shows "Web (built-in plugin)"; every earlier try-it step still works |
| 47. Level 1 for every language | tree-sitter grammars bundled; generic syntax call graph; generic run commands; project-type question at open | 20 repos in 15 languages open with a call graph and editor | Open a Rust or Go repo; see the "Basic support" banner and a call graph |
| 48. Level 2 via generic tools | Generic call-hierarchy edges; generic test hooks; detection rules for all ten categories; mixed projects | 10 non-web repos reach Level 2 flows without custom code | Open a Python repo; see "Structural support" and typed flows |
| 48a. Local runner | The workspace software as a small app for macOS, Windows and Linux; the same web UI connects to it; move a project between cloud and local through git; required for iOS simulators, physical hardware and GPU work | A project runs the same in cloud and local; moving it either way keeps code, checkpoints and canvas layout | Install the runner, move a demo project from the cloud to your laptop, keep working in the same browser tab |

## Stage 8: Coverage waves 2–10 (phases 49–75)

**Working milestone after each wave: one more category of software reaches full Level 3 support, and developers can open existing repos or build new projects of that kind from scratch.** Waves run strictly one at a time. After wave 10, every category discussed is covered.

**Every wave has the same three phases:**

1. **Analysis.** Fork 5–8 public repos covering the category; hand-label 20–30 flows; build the detectors, resolvers and connectors.
2. **Preview and runtime.** Build the preview adapter and runtime evidence for the category.
3. **Benchmark and ship.** Fix until the exit bar is met, run a 3–5 developer trial, add the forks to the permanent regression suite, release starter templates for new projects.

**Wave exit bar (phase 3 "done when"):** Level 3 on 80%+ of labelled flows; trial developers complete a real feature inside the product; every earlier wave's benchmark still passes.

| Phases | Wave and category | Forks to cover | Analysis work | Preview and runtime work |
| --- | --- | --- | --- | --- |
| 49–51 | 2. Python back ends, APIs, data pipelines | FastAPI service, Django app, Celery workers, Airflow or Prefect pipeline | Python resolver (Pyright); Django, FastAPI, Celery, SQLAlchemy connectors | API request playground as frames; pipeline run graph; OpenTelemetry for Python |
| 52–54 | 3. Mobile apps | React Native app, Flutter app, native Android (Kotlin), native iOS (Swift) | Dart, Kotlin and Swift support; navigation and screen connectors | Emulator and simulator screens as live frames; element-to-source for each framework |
| 55–57 | 4. Desktop apps | Electron app, Tauri app, Qt (C++) app | IPC connectors (main ↔ renderer, Rust ↔ JS, signals and slots) | App windows captured as frames |
| 58–60 | 5. CLI tools and libraries | Go CLI, Rust CLI, Python package, JS library | Command and public-API entry-point detectors; argument parsing connectors | Recorded terminal sessions as frames; runnable usage examples |
| 61–63 | 6. Distributed and event-driven systems | Multi-service Go or Java system with Kafka or RabbitMQ; gRPC microservice demo | Multi-repo workspace graph; topic, queue and gRPC connectors | Service map with live distributed traces (OpenTelemetry stitching) |
| 64–66 | 7. AI and ML systems | PyTorch training repo, LLM agent app, RAG service, notebooks | Notebook support; dataset, model and tool-call connectors | Training-run metrics and agent tool-call traces on the canvas |
| 67–69 | 8. Games | Godot project, Unity (C#) project, Bevy (Rust) game | Game-loop, scene, node and event-system connectors | Running game view as a frame; click an object to open its script |
| 70–72 | 9. Embedded and firmware | Arduino or ESP-IDF project, Zephyr RTOS app, STM32 HAL project | Interrupt-vector, RTOS-task and peripheral-register detectors; C/C++ resolver (clangd) | Simulator view (QEMU, Renode or Wokwi), serial monitor, optional hardware-in-the-loop with a connected board |
| 73–75 | 10. Systems software | Database engine, compiler or interpreter, Linux kernel module | Large C/C++ and Rust codebases; macro handling; scaling to millions of lines | Test-harness runs and traces as evidence |

**Try it after each wave phase:**

| Wave phase | What you can check at the preview link |
| --- | --- |
| 1. Analysis | Open the wave's demo project: entry points listed, flows drawn from code, "Structural support" banner |
| 2. Preview and runtime | Live frames for that kind of project (simulator, emulator, terminal recording, game view or trace map); click through and see the path light up. The CLI, mobile and firmware canvases in Figma 22, 23 and 24 show the target |
| 3. Benchmark and ship | Wave dashboard green; "Full support" banner; a new starter template in New project; every earlier wave's demo still passes |

## Stage 9: Teams, business and platform (phases 76–81)

**Working milestone: the complete product. Teams share canvases and review agent changes together, pull requests carry behavioural diffs, enterprises can deploy it under their own policies, and outside developers can extend it.** These phases can start in parallel with stage 8 once version 1.0 ships, if the team is large enough.

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 76. Accounts and billing | Team plans and billing: seats, shared usage pools, invoices, admin roles (individual plans arrive in 44a); team parts of the profile page | Upgrade, downgrade and offline use all work end to end | Sign in, check plan and usage on the profile page (Figma 18), go offline and keep working |
| 77. Shared canvases | Share a view, flow or session report by link; comments pinned to nodes and frames; team review of a session | Two developers review the same session and resolve comments together | Share a view with a teammate and comment on a node (Figma 19) |
| 78. Pull-request integration | GitHub and GitLab app posting behavioural diff, affected flows and test evidence on each PR; status check | Every PR in a fork gets a correct review comment within 5 min | Open a PR on a fork and follow the link to the report page (Figma 20) |
| 79. Enterprise | SSO, admin policies for agents, permissions and tracing, audit logs, own model endpoints, self-hosted option | A pilot company deploys it with its own SSO and model endpoint | Sign in through a test SSO and check the audit log |
| 80. Public plugin SDK | Documented SDK for the five extension points; plugin registry; signing and review | An outside developer ships a working connector for an uncovered stack | Install the sample community plugin from the registry |
| 81. Own cloud and regions | Bring your own cloud and regions: workspaces in the customer's own cloud account, region choice, larger machines and GPUs | A large systems project runs remotely while the canvas stays responsive | Open a heavy demo project in a remote environment |

## Definition of done: the finished software

**After phase 81, every item below works. Tick each one only when its tests pass in the regression suite.**

**Design**

- [ ] All 31 Figma screens implemented and passing the screenshot comparison
- [ ] Graphite design language with the muted palette, in dark and light themes
- [ ] Component catalogue matches the Figma component library

**Canvas and understanding**

- [ ] Canvas is the main surface: live UI frames, flows, code and agent panel side by side
- [ ] Live UI frames for every category with a visual output (web, mobile, desktop, games, simulators), with saved states
- [ ] Click any element or entry point to see its full flow: handlers, logic, APIs, data, external services, background work; every node opens an inspector with full detail and in-place editing
- [ ] Graph view and sequence view; async work in its own lanes
- [ ] Progressive disclosure, semantic grouping, stable layout
- [ ] Provenance on every edge (observed, resolved, convention, suggested, unknown) and a completeness meter per flow

**Building with AI**

- [ ] Claude Code, Codex and other ACP agents run inside the product
- [ ] Agents get full context by default; optional selection focuses them; out-of-scope edits flagged
- [ ] Frames and flows update live after every agent step
- [ ] Behavioural diff, blast radius, and before/after comparison for every session
- [ ] Accept, reject or revert per step or per session
- [ ] MCP server gives agents the flow graph as context
- [ ] Prompt from anywhere: chat, nodes, selections, flows, entry points, events, live frames, tests, review items and comments, with context chips and @-mentions
- [ ] Direct editing: inspector fields, code cards and live-frame text and style edits, all checkpointed
- [ ] Choice of coding agent and model per session; the product's own AI runs on any provider or a local model, routed per task

**Verification**

- [ ] Relevant tests per change, one-click runs, results on the canvas
- [ ] Test-run and dev-server tracing produce *observed* edges
- [ ] Review panel: changed, affected, tested, observed, unverified
- [ ] LLM labels and suggestions, with no-LLM mode and bring-your-own model

**Full IDE**

- [ ] Code editor with language intelligence, search, refactoring
- [ ] Terminal, run manager, git panel, debugger
- [ ] Command palette, keybindings, themes, settings, multiple projects
- [ ] Open existing repos from a URL or uploaded folder; new projects from a prompt or template
- [ ] "Open in VS Code or Cursor" escape hatch
- [ ] Settings (privacy and runtime, agents, models, editor, project, appearance, notifications) and profile page
- [ ] Session report page with Markdown export

**Coverage**

- [ ] Level 1 for every language with a tree-sitter grammar
- [ ] Level 3 for all ten categories: web, Python back ends, mobile, desktop, CLI and libraries, distributed systems, AI/ML, games, embedded, systems software
- [ ] Project-type detection with confirmation; mixed projects supported
- [ ] Full forked-repo regression suite for all waves passing on every release

**Platform, teams and safety**

- [ ] Isolated cloud workspaces with autosave, backups, restore history and sleep when idle; secrets never indexed; telemetry off by default
- [ ] Large repos stay responsive (p90 update under 3 s)
- [ ] Accounts, billing, shared canvases, PR integration, enterprise controls
- [ ] Public plugin SDK and registry; optional cloud environments
- [ ] Preview links, demo projects, try-it steps and recorded runs kept working through every release
- [ ] Local runner, with projects movable between cloud and local
- [ ] Free allowance, individual and team plans, and usage limits that never lose work
