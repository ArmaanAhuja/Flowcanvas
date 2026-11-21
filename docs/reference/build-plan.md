# Build Plan v2: a desktop app for understanding AI coding

Nov 2026 · replaces the web plan (`build-plan-v1-web.md`, kept as history; phases 1–13 of it are built).

**Flowcanvas is a desktop app (Linux first, then Windows, then macOS) for building software with AI agents while understanding what they do.** People see their running app, a map of it in human terms, and short paths for each action; they steer the agent from any of these, and review its work as behaviours with proof, not as file diffs. Flow graphs stay as an advanced detail view only.

> **Owner decisions this plan rests on** (Nov 2026):
> - Big flow graphs are too hard to read and defeat the purpose; the product must make AI coding understandable for humans, who understand visually.
> - Desktop app instead of web; Linux first, then Windows, then macOS.
> - The three views: **the live app**, **paths** (one action as a short line), **the app map** (features, screens, data).
> - Jobs: **learn**, **steer** and **review**, all three. First users: people building their own projects, and startup founders.
> - The user decides whether the agent shows a plan and waits. Several agents if possible; **Claude Code is the main one**.
> - Process (21 Nov): tests in small steps plus one combined test per milestone; no screenshots or Figma matching; one brief CHANGELOG entry per milestone.
>
> **Defaults assumed until the owner says otherwise** (each one is easy to change):
> - **First version's extra ideas:** plan cards, review by behaviour, risk radar, proof per behaviour, session storyboard, ask anything. Later: guided tours, guardrails, drawing on screenshots, explain-level slider, tests as stories, click-through replay.
> - **AI summaries** (station sentences, area names) are written by the user's own Claude Code (no separate API key); a no-AI mode shows code facts only.
> - **First supported projects:** TypeScript web apps (what the engine reads today); APIs and CLIs shown through requests and terminal output.
> - **First milestone:** one real loop on the owner's own projects, not a mock.

## How this plan works

- **Phases** are small (days, not weeks, with AI agents doing most of the typing). Each lists what to **build**, a **done when** proven by tests, and a short **try it**.
- **A milestone** is one phase or a few related ones. At its end: one combined test of what changed and what it affects; CI green; one brief CHANGELOG entry; the owner accepts.
- **Rules kept from v1:** always runnable; test on the public forked corpus (`corpus/manifest.json`), never the user's own projects as test data; **never fabricate**: every fact says where it came from (found in the code, seen running, AI's summary, unknown) and unknown is shown, not guessed; secrets (`.env`) are never indexed, logged or sent to a model; telemetry off by default; agents are wrapped, never replaced; checkpoints never touch the user's branches (shadow refs); design tokens only (Graphite, Signal palette).
- **Dropped from v1:** cloud workspaces, accounts and sign-in, the control plane, gateway and preview proxy, billing, staging previews per PR, screenshot and Figma comparison, the long living docs. Teams and cloud may come back much later, as options.

## What carries over from v1 (phases 1–13, built)

| Built | Becomes |
| --- | --- |
| Monorepo, CI, design tokens, Graphite components and catalogue | Same, inside the desktop app |
| CodeMirror editor, files, autosave journal, file watcher | The editor on local files |
| Engine: index, search, TypeScript semantics, graph, entry points, connectors (UI → API, data, services, hand-offs), stored facts | The brain behind the map, paths and review; runs locally |
| Entry-points panel | The list of actions each area offers |
| Flows, groups, sequence view | "Advanced: full flow" detail view; the sequence view's rows become the session storyboard's style |
| Docker workspaces, control plane, accounts, gateway | Retired (kept in git history) |

## Tech stack (desktop)

| Part | Choice | Why |
| --- | --- | --- |
| App shell | **Electron** | The engine is Node and the TypeScript compiler API: Electron runs it natively, in a utility process off the UI thread. Tauri would need the engine as a separate sidecar |
| Packaging | AppImage and .deb first; auto-update later; Windows (NSIS) and macOS (signed .dmg) in their stages | Linux first, as decided |
| UI | React + TypeScript, Graphite components (existing) | Reused |
| The live app | Electron `WebContentsView` showing the project's own dev server | Real browser, real app, local |
| Element ↔ code | Dev-only SWC/Babel plugin stamping JSX with file and line | Click a button, get its code and path |
| Running projects | node-pty + xterm.js; the project's own scripts | No containers needed on the user's own machine |
| Analysis | Existing engine (tree-sitter, TypeScript API, SQLite store) | Reused |
| Agents | Agent Client Protocol client; Claude Code first (and its hooks), then Codex and Gemini CLI | Wrap agents, don't build one |
| AI summaries | The user's Claude Code in headless mode, cached by content hash; no-AI mode | No second key to manage |
| Checkpoints | Git CLI with shadow refs | Undo any step without touching branches |
| Tests and evidence | Vitest/Jest/Playwright runners with tracing (OpenTelemetry) for real example values | Tests are the cheapest proof |

## Stage 1: The desktop foundation (phases 1–4)

**Milestone: install the app on Linux, open a project folder, and everything built so far (editor, search, entry points, flows) works locally, with the project running inside.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 1. Desktop shell | Electron app with the existing UI; open a local folder (recent projects list); the engine in a utility process; AppImage and .deb builds in CI | The app installs from the .deb on a clean Ubuntu, opens Rallly and shows its files and search | Install the .deb, open Rallly's folder, press ⌘K and jump to a function |
| 2. Local files and editor | The editor reads and writes the project's files on disk; file watcher; tabs, save, undo, quick-open | An edit in the app is on disk at once; an edit from another editor shows in the app within 1 s | Edit a file in the app, then change it in another editor and watch it update |
| 3. Run the project | Detect dev, build and test scripts; start and stop with process cards and logs; integrated terminal; prompt for missing env vars (read from `.env`, never indexed or sent) | Rallly and Documenso start from one button; a missing variable shows a clear prompt | Press Run on Rallly and see its dev server start |
| 4. Engine on local projects | Index, graph, entry points and connectors on the local folder; re-analyse changed files on save; progress chip | Rallly, Documenso and Twenty analyse locally; a saved edit is reflected in under 3 s | Open Twenty, wait for analysis, edit a file and see entry points update |

## Stage 2: Understand: the map, paths and the live app (phases 5–11)

**Milestone: open any supported project and understand it visually: its areas, the short path behind any action, and its running screens, all linked.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 5. App map | Areas found from routes, screens, tables, jobs and folders; area cards listing screens, API endpoints, data, jobs and outside services; stable layout the user can arrange, rename and merge (remembered) | Each corpus web fork opens as 4–12 areas, every entry point in exactly one area | Open Rallly and read its map; rename an area and reopen the app |
| 6. AI summaries | Claude Code (headless) writes one-sentence summaries for areas, functions and stations, cached by code hash and marked "AI summary"; no-AI mode shows code facts only; repo text treated as data, never instructions | Summaries for one fork appear within 2 min and are reused instantly after a restart; with AI off, nothing is sent and the app still works | Turn AI summaries on and off and compare an area card |
| 7. Paths | One action (button, route, job, event) as a short line of meaningful stations (entry, handler, decision that matters, reads and writes, outside services, hand-offs) with plumbing folded; outcomes at the end; branches only for errors, permissions and different outcomes; at most one screen wide, the rest folded | For 20 labelled actions across the forks, every meaningful step the labels list is a station and no line is over one screen wide | In Documenso, open "Send document"'s path and read it end to end |
| 8. Data cards | The data model in plain words ("A poll has options and participants"), tables with their fields, which paths read or write each | Every Prisma/TypeORM/Mongoose model in the forks appears with its relations | Open Documenso's data cards and follow a table to the paths that write it |
| 9. The live app | The project's dev server inside the app; a screen gallery from the detected routes; device sizes; reload | Rallly's screens open in the gallery and are clickable | Run Rallly and browse its screens in the app |
| 10. Element ↔ code ↔ path | Stamping plugin; inspect mode: hover for a one-line summary, click for the element's path and code; a path's station highlights its screen element | 95% of clicked elements open the right line and path | Inspect the "Create poll" button and open its path |
| 11. Screen states and examples | Saved states per screen (logged in or out, empty, error) from seed data, fixtures or recorded clicks; real example values on stations from test runs and dev-server tracing, masked by default | 3 screens restore their states in one click; tested stations show a real example | Switch a screen to "empty", then read example values on its path |

## Stage 3: Build with AI: steer and review (phases 12–20)

**Milestone: the core loop. Ask Claude Code for a change, optionally approve its plan on the map, watch the screens and paths change step by step, and review the result as behaviours with proof; undo any step.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 12. Agent panel | ACP client; Claude Code inside the app (sessions, streamed messages, tool calls, its own permission prompts as approval cards); full project context by default | Claude Code completes a small feature in a fork from inside the app | Ask for a small change and approve its command |
| 13. Checkpoints and storyboard | A checkpoint per agent step (shadow refs); the session storyboard: each step as a frame with a one-line summary and the screens it changed; undo to any frame | A 10-step session gives 10 frames, each restorable exactly | Scrub a session's storyboard and restore step 2 |
| 14. Live updates | Re-analyse per agent step; areas being touched light up on the map; changed stations on paths (added, removed, changed); screens before/after per step with changed elements outlined | p90 update under 3 s per step on Documenso; for 10 seeded changes, exactly the changed areas and stations are marked | Watch the map and a path change while the agent works |
| 15. Plan cards (optional) | A switch: the agent first proposes a plan (steps, areas, tests) drawn on the map and paths; approve, edit or let it run | With plans on, nothing is written before approval; with plans off, it runs straight through | Turn plans on, ask for a change, edit the plan, approve |
| 16. Review by behaviour | The change as a checklist of behaviours ("Save now checks the rate limit"), built from path changes and AI summaries, each with its code diff underneath; accept or undo per behaviour where the code allows, per step otherwise | A reviewer finds a seeded side effect faster than with a file diff alone (timed with 3 people) | Finish a session and review it item by item |
| 17. Proof and risk radar | Per behaviour: tested ✓ (relevant tests run automatically), seen running ✓, or not yet checked ⚠; changes to login, payments, data deletion, secrets or the schema always raised to the top | For 10 seeded risky changes, every one is raised; every behaviour shows its proof state | Change an auth check in a fork and see it raised in red |
| 18. Steer from anything | Ask from an area, a station, a screen element or a review item; the context to be sent shown (secrets masked); a fence drawn from the map ("only work in Polls"): edits outside it flagged, never silently allowed | From 10 starting points the agent gets the right context; out-of-scope edits flagged in 10 of 10 | Fence the Polls area, ask for a change that would touch Billing, see the flag |
| 19. Agent questions | When the agent hits a real choice, it asks inline, with the options drawn on the path or screen | Seeded ambiguous requests produce a question instead of a guess in 8 of 10 | Ask for "delete polls" and answer the soft- or hard-delete question |
| 20. Ask anything | Point at anything and ask "why?" or "what happens if…"; answers cite the code, paths and runs, and say when something is unknown | Answers to 20 questions on the forks cite real code; none invents a connection | Ask "what happens when a vote is cast twice?" in Rallly |

## Stage 4: Version 1.0 for Linux (phases 21–25)

**Milestone: founders and solo developers build their own projects in it every day on Linux.**

| Phase | Build | Done when | Try it |
| --- | --- | --- | --- |
| 21. Open and start projects | Open a folder or clone from a URL; project-type check with an honest support banner; new project from a prompt or template, the map filling as files appear | 5 unseen public TypeScript web repos open with a map and paths; a 3-screen app is built from one prompt | Clone a repo you've never opened |
| 22. Daily essentials | Git panel (status, commit, branches, history beside checkpoints); project-wide search and replace; TypeScript language features (completion, diagnostics, go-to-definition); settings (agents, AI summaries on or off, privacy) | A full working day on the product itself without another editor | Commit a change from the app |
| 23. More agents | Codex and Gemini CLI through ACP; agent and model chosen per session | Switching agent mid-project keeps map, paths and history | Switch from Claude Code to Codex for one session |
| 24. Speed and stability | Large repos (Twenty) responsive; crash recovery; auto-update; opt-in crash reports | Twenty opens to its map in under 2 min; no work lost when the app is killed mid-session | Kill the app during a session and reopen it |
| 25. Beta | 10 founders or solo developers build real features in it; fix the top issues; 1.0 | 7 of 10 finish a real task and say they understood what the agent did | Read the 1.0 release notes |

## Stage 5: Deeper understanding (phases 26–31)

| Phase | Build | Done when |
| --- | --- | --- |
| 26. Guided tours | "How does sign-up work?" walks map → path → screens step by step | Tours for 5 questions per fork reach the right code |
| 27. Guardrails | Standing rules ("never touch payments", "no new dependencies", "keep the API") checked on every step | Every broken rule in 10 seeded sessions is shown |
| 28. Draw to ask | Circle or sketch on a screen and send it as a request | 8 of 10 sketched changes land on the right element |
| 29. Explain at your level | A slider from one line to full detail on any summary, path or review | Each level is accurate on 20 samples |
| 30. Tests as stories | Tests shown as plain scenarios linked to their screens and paths | Every test in two forks shows as a scenario |
| 31. Click-through replay | Record a scenario by clicking through the app; replayed after each change, differences shown; saved as a test | A recorded scenario catches a seeded visual regression |

## Stage 6: Windows, then macOS (phases 32–33)

| Phase | Build | Done when |
| --- | --- | --- |
| 32. Windows | Windows build (NSIS), paths, shells and process handling | The stage 4 beta tasks pass on Windows 11 |
| 33. macOS | Signed and notarised macOS build | The stage 4 beta tasks pass on macOS |

## Stage 7: More kinds of software (phases 34+)

One category at a time, each with the same three steps as v1's waves (analysis, the live picture, benchmark and ship), starting with **Python back ends**, then mobile, then others, chosen by what users ask for. A project in an unsupported language still opens with its files, editor, terminal, agent and an honest "basic support" banner.

## Later, as options

Sharing a session review by link; pull-request integration (behaviour review posted on a PR); a cloud runner for heavy projects; teams.

## Definition of done for 1.0 (end of stage 4)

- [ ] Installs and updates on Linux; opens local folders and cloned repos; runs the project inside
- [ ] App map, paths, data cards and the live app, all linked both ways, for TypeScript web apps
- [ ] Claude Code (and Codex, Gemini CLI) inside; plans optional; checkpoints and storyboard; undo any step
- [ ] Review by behaviour with proof states and the risk radar
- [ ] Steer from any view, with fences; agent questions; ask anything with citations
- [ ] Every fact labelled by where it came from; nothing invented; secrets never sent; works with AI off
- [ ] Editor, terminal, git, search and TypeScript language features for daily work
- [ ] 7 of 10 beta users finish a real task and understood what the agent did
