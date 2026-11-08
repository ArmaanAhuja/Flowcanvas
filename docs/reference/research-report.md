# Research Report: AI-Native Flow-Centric Development Environment

Oct 12, 2026 · @Manan

> **Note (7 Nov 2026):** the embedded editor is **CodeMirror 6**, not Monaco (owner decision, ADR 0021): Monaco can't run under the product's strict Content-Security-Policy without allowing inline style attributes, and it's much heavier per editor for code cards on the canvas. Where this report says Monaco, read CodeMirror 6; the reasoning about reusing an existing editor, language servers and a terminal still holds.

## Executive summary

**Verdict: buildable as a canvas-first, AI-native development environment that replaces the IDE, provided it starts with one kind of project and earns trust through evidence-labelled flows.** The universal vision stays as the architecture direction; the first release targets web apps only.

- **Product.** One canvas where the developer sees the running UI (rendered live, like frames in Figma), the real flow behind any element, and AI changes landing in both. Code editing, terminal, git and agents live inside it, so the whole project is built here. The behavioural diff is the trust layer inside the environment, not the product on its own.
- **Core bet.** Developers increasingly direct agents rather than type every line. The primary surface for that work should be a picture of the running app and how it works, not a file tree. Developer trust in AI output is falling while agent use rises, so seeing what changed is a growing pain.
- **Competition.** Onlook shows a live React UI on a Figma-like canvas but stops at the front end. Windsurf Codemaps gives AI-traced snapshot maps; AppMap gives runtime traces; AI IDEs own the editing loop with file trees and chat. None joins a live UI, full-stack flows and live agent changes on one canvas. CodeSee's 2024 shutdown shows that a visualiser alone, stretched across too many stacks, does not pay.
- **Feasibility.** Exact flows are undecidable in general; honest flows on one stack are achievable by layering syntax, type resolution, framework connectors and test-run traces. Mapping a live UI element to its source is already proven for React. The LLM only labels and suggests.
- **Recommended start.** TypeScript full-stack web apps, developed and tested against a corpus of forked open-source repos that range from a small scheduling app to a compute-heavy simulation with a web front end. Ship as a **web app with cloud workspaces**: users open a repo in the browser and it installs and runs on our servers, with autosave and backups built in. Wrap Claude Code and Codex via the Agent Client Protocol.
- **Biggest risks.** (1) IDE-replacement scope: editor, debugger, git and extensions are a large surface, and switching costs are high; (2) Cursor or Windsurf adding a canvas; (3) connector maintenance cost.
- **Next 8 weeks.** Assemble the forked repo corpus, run the flow-accuracy benchmark (E1) and 20+ developer interviews (E4) in parallel, and prototype the live UI canvas (E6). Proceed only if E1 and E4 pass.
- **Prompting and editing from anywhere.** Developers can ask from the chat, a node, a selection, a whole flow, an event, a live frame element, a failing test or a comment; the right context is attached automatically. Small changes (text, props, prompts, queries, config) can be edited directly on the canvas.
- **Model choice.** Coding agents bring their own models; the product's own AI (labels, explanations, search) runs on any provider or a local model, chosen per task.
- **Design and delivery.** The Graphite design language with a muted palette (31 screens in Figma) and a 96-phase build plan (81 numbered + 15 lettered) in which every phase ships something you can install and try.
- **Where code runs (decided).** First users are individual developers and startups, so the product is web-first: every project runs in an isolated cloud workspace with autosave, backups and sleep when idle. A local runner follows later for people who need code on their own machine and for categories the cloud can't run (iOS simulators, physical hardware). Running other people's code makes hosting cost and isolation two of the biggest risks to manage.

## Core value proposition

The product's core value is **one canvas where a developer sees the running app, the real flows behind it, and AI changes landing in both, and builds the whole project from there.** The behavioural diff is the trust layer that makes directing agents safe; it is a feature of the environment, not a separate review tool.

**The vision, restated.** The canvas is the main surface. Live UI screens render from a real browser engine as frames, the way Figma lays out artboards. The developer selects anything (a button, route, command, job, event) and sees the real flow behind it as an explorable graph, with every edge labelled by how it is known. They ask an AI agent for a change, or edit code directly, and watch both the UI and the flow update as real files change, with the code diff one click away.

**Why this matters now (reasoned hypothesis).** Agents now write large multi-file changes faster than humans can follow them. The developer's job is shifting from typing code to directing and checking it. A file tree and a file diff show *what text changed*; developers need *what the app now does, and where else it leaks*. Today that answer comes from the agent's own summary, which is the thing being checked.

**One-line pitch:** "Build your app on a canvas: see it running, see how it works, and watch AI change it safely."

**Value layers:**

1. **Building on a live canvas.** UI frames, flows and code side by side, so the canvas, not the file tree, is where daily work happens. This is the IDE-replacement layer and the reason developers stay all day.
2. **Verifying agent changes.** Behavioural diff, blast radius, relevant tests and what was not verified.
3. **Understanding unfamiliar code.** Onboarding, debugging and pre-change exploration ("what happens when I click Export?").
4. **Agent context in two modes.** By default the agent gets full repository context and is free to change whatever the task requires; the developer never has to select anything. Selecting nodes is an optional way to focus it ("change only this branch"). When an agent edits outside the selection, the canvas flags those changes as out of scope instead of blocking them, so freedom and visibility coexist.

The central loop to protect: **see the app and its flows → (optionally select) → ask the agent or edit → watch the UI and flow change → verify → accept or revert.**

### Prompting and editing from anywhere

**There is one agent session with many ways in: wherever the developer starts, the product attaches the matching context, and the agent can still read the whole project.** Changes always run as normal agent steps, so they are checkpointed and shown in the behavioural diff.

| Start from | Context attached automatically |
| --- | --- |
| Chat box | Nothing extra; full project by default |
| A node (hover action, right-click, ⌘K) | That node's code, inputs and outputs, provenance and recent runs |
| Several nodes or a lassoed region | The selection, marked as focused; edits outside it are flagged, not blocked |
| A flow or entry point | The flow graph: every node, edge and how each is known |
| An event or job | Its producers, consumers and payload shape |
| A live UI element | The element, its source location and the flow behind it |
| A failing test, review item or comment | The trace, the diff or the thread |
| `@` mentions in any prompt box | `@node`, `@flow`, `@route`, `@event`, `@file` |

A prompt from a node opens a bar anchored to that node. Questions ("why could this break?") get a read-only answer in a popover beside the node, with a "Fix it" button that turns the answer into a change. Before sending, the composer shows exactly what context will go to the agent, with a size estimate and secrets masked.

**Direct editing, from lightest to heaviest:**

1. **Edit in place.** Any inspector value that is written literally in the code (a prompt, a query, a config value, a prop) can be edited and saved straight to its source location.
2. **Code card.** Double-click a node to open a small editor beside it on the canvas.
3. **Live frame edit.** Change a UI element's text, props or simple styles inside the running app; the edit lands on the stamped source line and hot-reloads. Anything that changes behaviour is handed to the agent with the element attached.

Every direct edit becomes a checkpoint and updates the flow exactly like an agent step.

## Users and problems to prioritise

Prioritise **professional developers who build and maintain web apps day to day with AI agents, and who would do their whole working session in the product.** Reviewing agent changes is one of their jobs inside it, not a separate persona.

**First users (decided): individual developers and startups building their product.** They value zero setup, instant previews and automatic backups more than keeping code off a vendor's servers, which is why the product starts web-first with cloud workspaces. Companies with strict privacy rules come later, served by a local runner and, eventually, workspaces in their own cloud account.

The demand signal is real but measured. In Stack Overflow's 2025 survey, 84% of developers used AI tools while 46% distrusted their accuracy, up from 31% the year before ([TechRepublic](https://www.techrepublic.com/article/news-developer-trust-in-ai-declines/)). Only 3% highly trusted AI output, and 87% were concerned about the accuracy of AI agents specifically ([ADTmag](https://adtmag.com/blogs/watersworks/2026/01/stack-overflow-survey.aspx)). Qodo's 2026 report frames it as "verification is the new bottleneck" ([Qodo](https://www.qodo.ai/blog/ai-code-review/)).

| Segment | Core problem | Fit now | Why |
| --- | --- | --- | --- |
| Developers building web apps with agents | "I want to build, see and change my app in one place" | **Primary** | Daily, all-day use; the IDE-replacement user |
| The same developers in review mode | "What did this 14-file agent change actually do to behaviour?" | **Primary** | Highest trust pain; the reason to switch from a file-diff IDE |
| Engineers onboarding to an unfamiliar codebase | "What happens when I click Export?" | Secondary | Strong pull into the product; weak willingness to pay on its own |
| Designers and PMs adjusting UI | "Change this screen without opening code" | Later | The live UI canvas makes it possible; Onlook already targets it |
| AI-heavy builders with less experience ("vibe coders") | Do not understand their own app | Not first | Large audience, low retention and low payment |
| Embedded, game, OS and ML teams | Same pain, very different runtimes | Not first | Each needs its own analysers and previews; revisit after the core loop is proven |

**Problems to solve first, in order:** (1) build and change the app from a live canvas instead of a file tree; (2) see exactly which behaviours an agent change touched; (3) see the blast radius beyond the files edited; (4) know what was and was not verified.

## Competitive landscape

**No product found combines a live UI canvas, code-grounded full-stack flows, live updates while an agent edits, and an evidence-labelled behavioural diff in one development environment.** Each piece exists somewhere; the integration does not. The closest threats are Onlook on the canvas side and AI IDEs adding a canvas.

| Category | Examples | What they do well | Gap against this vision |
| --- | --- | --- | --- |
| Live UI canvas editors | [Onlook](https://github.com/onlook-dev/onlook) (open source, about 25k GitHub stars) | Runs a Next.js + Tailwind app in a container, shows it on a Figma-like canvas, maps DOM elements to source by instrumenting code, AI chat edits | Front end and styling only; no back-end flows, async work or behavioural diff; aimed at designers more than developers |
| AI-annotated code maps | [Windsurf Codemaps](https://cognition.com/blog/codemaps) (Cognition, Nov 2025) | Task-scoped, LLM-generated maps linked to exact lines; usable as agent context | Each map is a snapshot; LLM-traced, not evidence-labelled; no live diff during agent edits; locked to Windsurf |
| Codebase visualisers | [CodeViz](https://news.ycombinator.com/item?id=41393458) (YC S24), [CodeBoarding](https://www.blog.brightcoding.dev/2026/02/16/codeboarding-ai-powered-interactive-diagrams-for-codebases), [AtomicViz](https://github.com/briandiloreto/AtomicViz), CodeLayers | Call graphs from language servers, architecture diagrams, click-to-code | Structural, not behavioural; weak across service boundaries; not tied to agent sessions |
| Runtime-trace visualisers | [AppMap](https://github.com/marketplace/get-appmap) | Records real execution from tests; sequence-diagram diffs; SQL and HTTP capture | Needs a runnable app or tests; per-language agents; no live agent loop |
| Repo-aware AI PR reviewers | CodeRabbit, Greptile, Qodo, Cursor Bugbot, Claude Code Review ([overview](https://www.startearly.ai/post/top-11-ai-code-review-tools/)) | Cross-file impact, sequence diagrams, comments at PR time | Text comments after the fact, not a navigable behavioural view; mostly LLM judgement |
| AI IDEs and agents | Cursor, Windsurf, Zed, Claude Code, Codex | Own the editing loop and the user's attention | File tree and chat first; file-diff review; no live UI canvas or grounded flow model. The incumbents this product must replace |
| Observability | OpenTelemetry stacks, Sentry, Datadog | Ground-truth runtime traces in production | Not connected to source-level change review |

**The graveyard is instructive.** CodeSee (codebase maps, about $10M raised) stopped commercial operations in Feb 2024 and its team went to GitKraken ([CB Insights](https://www.cbinsights.com/company/codesee)). Its founder's stated reason: making revenue required covering more complex codebases, IDEs, stacks and languages than time allowed ([post](https://sk.linkedin.com/in/daniel-ivanyi-16845458)). That is exactly the universality trap this product must avoid.

**Decision: avoid the universality trap by building for one kind of project first and expanding deliberately.** At project open, the product asks what kind of project it is (web app, API service, CLI, firmware, and so on) and loads the matching analysers and preview. Unsupported kinds still open as code plus a basic call graph, clearly labelled as reduced support.

**Two takeaways.** First, "visualise my codebase" as an add-on has repeatedly failed as a business. A visualiser is optional; the place where developers build is not. Second, Cognition's Codemaps post argues that engineers are moving from authoring to accountability, which validates the thesis and confirms that well-funded incumbents are circling it.

**Positioning (decided): the end goal is a development platform that replaces the traditional IDE, not a codebase visualiser.** The developer builds and controls the entire project from the canvas. This raises the bar: the product must handle a full working day (editing, running, debugging, git) well enough that developers do not keep a second IDE open. The recommended way to meet that bar without rebuilding everything is in the scope and weaknesses sections.

## Technical approaches

**Build the flow from layered evidence, each layer tagging its own edges: syntax, then semantic resolution, then framework connectors, then runtime traces. Use LLMs only to label, summarise and propose candidate edges, never to assert them.** Each layer's provenance travels with the edge into the UI.

| Evidence layer | Technology options | What it gives | Limits | Provenance tag |
| --- | --- | --- | --- | --- |
| Syntax | tree-sitter (incremental, 100+ languages) | Fast parse of every file, symbols, call sites; re-parses only edited ranges | No name resolution; cannot tell which `save()` is called | *syntactic* |
| Semantic resolution | Language servers (tsserver, Pyright), SCIP indexers, compiler APIs, Jelly for JS | Definitions, references, type-resolved calls | Dynamic dispatch, reflection, `obj[key]()`; language servers are slow on very large repos | *resolved* |
| Framework connectors | Hand-written rules per framework: routes, ORM models, queue topics, React event props, cron configs | The cross-boundary edges users care about most | One connector per framework; must be maintained | *convention* |
| Runtime traces | OpenTelemetry auto-instrumentation, test-run tracing, AppMap-style recorders | Edges confirmed by real execution, including dynamic calls | Needs runnable code or tests; covers only exercised paths | *observed* |
| LLM inference | Any frontier model over retrieved code | Names nodes, summarises, proposes edges static analysis missed | Can hallucinate; non-deterministic | *suggested* (always shown as unverified) |

**Established facts.** Sound and precise static call graphs for real-world JavaScript are an open research problem. Studies of state-of-the-art builders on framework web apps found dynamic property access to be the most common cause of missed edges ([Chakraborty et al., ECOOP 2022](https://drops.dagstuhl.de/opus/volltexte/2022/16231/)). In a 2024 comparison, the Jelly static analyser beat LLMs on soundness for JavaScript call graphs. The LLM did better only on dynamically computed object keys ([arXiv 2410.00603](https://arxiv.org/pdf/2410.00603)). Static analysis should be the backbone; the LLM fills specific gaps.

**Reasoned hypothesis.** For the flows a reviewer cares about, most edges come from a short list of framework conventions: HTTP client to route, route to handler, handler to ORM, enqueue to worker. If those connectors cover the top 3–5 frameworks of the wedge stack, recall on real flows could be high even where general call-graph recall is not. Experiment E1 tests this.

**Agent integration (decided: wrap existing agents).** Three practical hooks, in order of preference:

1. **Agent Client Protocol (ACP).** An open, JSON-RPC protocol from Zed between editors and agents. It reached v1 with 25+ compatible agents by early 2026, including Claude Code and Codex via adapters ([Zed](https://zed.dev/acp), [overview](https://codex.danielvaughan.com/2026/06/10/agent-client-protocol-microsoft-intelligent-terminal-codex-cli-multi-agent-ide-ecosystem/)). Being an ACP client means one integration, many agents, with streamed tool calls and edits.
2. **Agent hooks.** Claude Code `PostToolUse` hooks fire after each tool operation ([docs](https://docs.claude.com/en/docs/claude-code/hooks)). Each file write becomes a checkpoint event with the agent's intent attached.
3. **Filesystem and git watching.** Agent-agnostic fallback; loses intent and step boundaries.

**MCP in the other direction.** Expose the flow graph to agents as MCP tools ("what calls this?", "what flows touch this file?"). Agents get grounded context, and the user's canvas selection can scope the agent's task.

**Live UI on the canvas (established approach, new combination).** Run the project's dev server and render each route or screen as a frame in an embedded browser view, laid out like Figma artboards. A build-time plugin (Babel or SWC) stamps each JSX element with its source file and line, so clicking an element in a frame resolves to code. Onlook uses this instrument-and-map approach for React today ([Onlook](https://github.com/onlook-dev/onlook)). The new part is what happens next: the clicked element becomes the entry point of a full-stack flow, and agent edits hot-reload in the frame while the flow graph updates beside it.

- Hot module replacement gives near-instant visual feedback after each agent write.
- Frames need states (logged in, empty cart, error) to be useful; seeded fixtures or recorded sessions provide them.
- A compute-heavy app with a web front end (for example a simulation rendering to a canvas element) previews fine, but its interesting logic sits behind the UI, which is exactly where the flow graph adds value.

**Model choice: two separate layers.** Keeping them apart avoids promising control over models the product doesn't run.

| Layer | What it does | How models are chosen |
| --- | --- | --- |
| Coding agents | Make the actual code changes (Claude Code, Codex, Gemini CLI and others via the Agent Client Protocol) | Each agent runs its own models under the user's own sign-in. The composer offers an agent picker plus whatever models and modes that agent exposes |
| Product's own AI | Names and summarises nodes, suggests missing edges, answers quick questions, powers search | A provider-neutral model gateway: Anthropic, OpenAI, Google, Mistral, local models (Ollama, LM Studio), any OpenAI-compatible URL, and Bedrock, Vertex or Azure for enterprises. Keys stay in the encrypted secrets vault; each task can use a different model; a self-hosted-only mode sends nothing to third-party providers; a no-AI mode keeps everything working without labels |

## Hardest feasibility questions

**Complete, correct flows for arbitrary software are impossible in principle. Useful, honest flows for one well-chosen stack are feasible.** Exact control flow is undecidable in general, so the product must sell calibrated partial knowledge, not completeness.

| # | Question | Why it is hard | Verdict |
| --- | --- | --- | --- |
| F1 | Can cross-boundary edges (UI → API → DB → queue → worker) be found reliably? | They are string- and convention-based, not language semantics | Feasible per framework; this is the core moat and the core cost |
| F2 | Can the graph update within seconds of each agent edit? | Re-indexing whole repos takes minutes; language servers lag | Likely feasible: incremental parse plus re-resolving changed files and their direct dependents |
| F3 | Can a behavioural diff be computed, not just a file diff? | Must map text edits to graph edits and then to flows | Feasible as a graph diff of before and after snapshots, scoped to flows touching changed nodes |
| F4 | Can the layout stay stable as the graph changes? | Graph layout algorithms reshuffle nodes on small changes | Solvable with pinned positions and incremental layout; a known UX engineering problem |
| F5 | Can runtime evidence be gathered without heavy setup? | Apps need env vars, databases, secrets to run | Partly: tests are the cheapest runtime evidence; full app runs stay opt-in |
| F6 | Can it scale to large monorepos? | Millions of nodes; slow language servers | Feasible with lazy, entry-point-scoped analysis instead of whole-repo graphs |
| F7 | Universal support across languages and domains | Each ecosystem has its own runtime, entry points and conventions | Not feasible as one engine; feasible as a shared graph model plus plugins |

**Fundamental limits to state plainly in the product:**

- Reflection, `eval`, dependency injection containers, plugin loading and config-driven dispatch defeat static analysis; they appear as *unknown* or *suggested* edges.
- External services are opaque beyond their API contract.
- Generated code (ORMs, protobuf, GraphQL codegen) must be analysed from generated output or modelled by a connector.
- Runtime coverage is only as good as the tests or sessions that ran.
- For embedded, OS and hardware-integrated code, entry points include interrupts, DMA and hardware registers. Static analysis there is often easier (C, fewer dynamic features) but runtime observation is much harder.

## Architecture options and trade-offs

**Recommended architecture: an analysis engine that runs beside the code, inside each project's workspace, maintaining one versioned, provenance-tagged flow graph fed by agent checkpoints and runtime evidence, and read by both the developer's canvas in the browser and the agent itself.** The graph model is the universal layer; analysers and connectors are per-ecosystem plugins. The workspace runs in our cloud by default and, later, on the user's machine through a local runner.

&#91;embedded content: proposed architecture · 9 components, agent-agnostic\]

Each agent step or direct edit is captured, analysed incrementally and stored as a graph snapshot; the diff between snapshots drives the canvas, while the live UI frames hot-reload beside the flows. The MCP server feeds the same graph back to the agent as grounded context.

**Live update pipeline, per agent step:**

1. Agent completes a tool call that writes files; an ACP event or hook fires.
2. Change capture records a lightweight git checkpoint and the agent's stated intent.
3. Changed files are re-parsed; their symbols and direct dependents are re-resolved; connectors re-run on those files.
4. Cached flows containing affected nodes are invalidated and recomputed; others are untouched.
5. The new snapshot is diffed against the session baseline; the canvas animates the changes and marks pending areas *analysing*.
6. Tests mapped to changed nodes are offered (or auto-run, if enabled) and their traces become *observed* evidence.

**Key decisions and options:**

| Decision | Options | Recommendation | Main trade-off |
| --- | --- | --- | --- |
| Agent integration | ACP client; per-agent hooks; filesystem watch; own agent | ACP client plus Claude Code hooks; filesystem watch as fallback | ACP adapters for some agents are third-party; hooks are vendor-specific |
| Analysis backbone | Language servers only; SCIP index plus custom resolver; Datalog engine (CodeQL-style); LLM-only | SCIP-style index plus tree-sitter plus per-framework connectors | Language-server-only is fast to build but slow at scale; LLM-only is fast to build but untrustworthy |
| Graph model | Fixed layered schema (UI → API → DB); generic typed property graph | Generic graph with a small core vocabulary: entry point, code unit, call, decision, data access, async hand-off, external boundary | Generic is more work to render well but avoids forcing every app into a web shape |
| Storage | In-memory plus SQLite; embedded graph DB; server graph DB | In-memory plus SQLite per repo, content-hash keyed | Simple, one store per workspace on its persistent volume; included in workspace snapshots and backups |
| Delivery surface | VS Code extension; VS Code fork; desktop IDE; web app with cloud workspaces; web app with a local runner | Web app (browser) with cloud workspaces first; local runner later; Monaco editor, terminal and git built in; "open in VS Code or Cursor" through a remote connection to the workspace | Zero install, instant preview links and built-in backups, at the cost of running and securing infrastructure; the user's browser renders live frames, so no bundled browser is needed; a VS Code fork is still a costly maintenance treadmill |
| Runtime evidence | None; test-run tracing; OpenTelemetry on dev server; production traces | Test-run tracing in v1, dev-server tracing opt-in | Tests are cheap and safe but cover only tested paths |

### Where the code runs: cloud workspaces first (decided)

**The product is a web app, and every project runs in an isolated cloud workspace by default, so users install nothing and get autosave, backups and shareable previews for free; a local runner later reuses the same workspace software on the user's machine.** The analysis engine, dev server, agent and tracing must run where the code runs, so the browser UI is identical in both cases.

| Part | What it does |
| --- | --- |
| Web app | Canvas, panels and editor in the browser. The editor buffer lives in the browser so typing is instant, and syncs to the workspace |
| Control plane | Accounts, projects, scheduling, secrets vault, usage metering, billing and backups |
| Workspace | One isolated lightweight virtual machine (Firecracker-style) per project, holding the repo, installed dependencies, dev server and workers, analysis engine, tracing and the agent's command-line tool |
| Gateway and preview proxy | Live connection between browser and workspace; each running app gets a private preview URL that the canvas shows as a live frame |
| Autosave and backups | Edits journalled within seconds; every checkpoint pushed to a private backup remote; workspace snapshots on a schedule and on sleep; restore any point from history |
| Sleep and wake | Idle workspaces sleep after a few minutes and resume from a snapshot, the main lever on cost |
| Prebuilt caches | Common stacks pre-installed so a new workspace starts in seconds |
| Local runner (later) | The same workspace software as a small app on the user's machine; the same web UI connects to it; projects move between cloud and local through git |

**Agents in the cloud.** Claude Code or Codex run inside the workspace, signed in with the user's own account or API key, stored in the secrets vault. The product still does not run its own coding model. Each agent's terms for hosted use need checking before launch.

**Cost.** The closest existing service, GitHub Codespaces, charges about $0.18 an hour for a 2-core machine and $0.36 for 4-core, plus $0.07 per GB-month of storage ([GitHub docs](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)). Running our own infrastructure will be cheaper than that retail price, but compute is a real cost per user. That points to a free allowance for trying the product on public and small repos, a usage-based individual plan, a team tier, aggressive sleep, prebuilt caches, and later bring-your-own-cloud.

**What still needs local or special machines.** iOS simulators need macOS, firmware can need real hardware, and model training needs GPUs. Waves 3 (mobile), 9 (embedded) and 7 (AI/ML) therefore depend on the local runner or paid special machines.

**Universality strategy:** a stable plugin interface with three parts per ecosystem: an **entry-point detector** (what can a user select?), an **edge resolver** (calls and data access), and **boundary connectors** (how this ecosystem talks to others). Asking the user what kind of project it is serves as a fallback for choosing plugins. Embedded firmware would add detectors for interrupt vectors and RTOS tasks, using the same graph and canvas.

## Trust, provenance and canvas UX

**Trust is the product. A single convincing but wrong edge, discovered once, costs more than ten correct ones earn.** Every visual element therefore carries provenance, freshness and change state, and the canvas never draws a solid line it cannot back.

**Edge provenance (visual encoding is a hypothesis to test):**

| Tag | Meaning | Proposed encoding |
| --- | --- | --- |
| Observed | Seen in a runtime trace or test run | Solid line, check mark, link to trace |
| Resolved | Proven by type-resolved static analysis | Solid line |
| Convention | Matched by a framework connector rule | Solid line, connector badge ("Express route") |
| Suggested | Proposed by an LLM, unverified | Dotted line, "unverified" label, opt-in |
| Unknown | Dynamic call that could not be resolved | Open stub: "calls something via `handlers[type]`" |

**Change state**, layered on top: *added*, *removed*, *modified*, *possibly affected* (downstream of a change), *unchanged*. Freshness: any node whose analysis is behind the latest edit shows *analysing* and is never drawn as current.

**Visual language (decided).** The interface follows the [Graphite design language](https://claude.ai/artifact/9hPHec6ABd43eipPKkn9Zn): near-achromatic slate chrome, with colour reserved for meaning. Change states use muted shades (sage for added, ochre for modified, clay for removed, lavender for possibly affected, mauve for outside the selection); provenance is shown by line form only (solid, check mark, dotted, open stub), never by colour. All 31 screens are drawn in the Figma file.

**Canvas principles:**

1. **Start from a question, never a whole-repo map.** The canvas opens on one entry point and one level of depth.
2. **Progressive disclosure by semantic grouping.** Collapse to "Auth service" or "Validation (4 functions)"; expand on demand.
3. **Two views of the same graph.** A spatial node graph for structure, and a sequence or timeline view for execution order, async hops and retries. Background work reads far better in the second.
4. **Async as first-class hand-offs.** Enqueue → queue → worker is drawn as a break in time with its own lane, not a normal call.
5. **Code is always one click away**, and the diff is one click away from any changed node.
6. **Stable layout.** Pinned positions; new nodes animate in; removed nodes ghost out instead of vanishing.
7. **A completeness meter per flow**: e.g. "18 edges: 11 resolved, 4 convention, 2 observed, 1 unknown", so gaps are visible at a glance.

**Reviewing AI changes.** The review panel separates: changes made in code; possibly affected flows; tests run and results; behaviour observed; and what is unverified. Accept, reject and revert operate on the agent's git checkpoints, not on the picture.

**Node inspector: everything a developer needs to know about a step.** Selecting any node shows its full detail, not just a label. The minimum per node type:

| Node type | From the code | From real runs |
| --- | --- | --- |
| UI element | Component, props, state read, handlers, styles | Rendered values, re-renders |
| Function | Signature, types, branches, side effects, callers | Arguments, return values, duration |
| API route | Method, URL, request and response shape, auth, middleware | Actual requests and responses, status, latency |
| Data access | Query, tables and columns, read or write | Rows returned or changed, query time |
| External service | Endpoint or SDK call, env var names, retries | Payloads, responses, errors |
| AI or LLM call | Prompt template, model, parameters, inputs, output format | Filled-in prompt, response, tokens, cost |
| Queue, job or event | Name, payload shape, retries, schedule | Runs, failures, durations |
| Config, auth, errors, files | Flags and env vars, roles and guards, handlers, limits and paths | Current values (secrets masked), who ran it, exceptions |

If a detail is in the code and affects behaviour, the inspector shows it, tagged with where it came from. Real values appear once runtime tracing is on, with secrets and personal data masked by default.

## Performance, scalability, security and privacy

**Run analysis inside each project's workspace, scope it to what the user is looking at, isolate every workspace from every other, and keep secrets out of logs, indexes and model requests.** Hosting other people's code makes security and cost core product work, not afterthoughts.

**Performance and scale:**

- **Index once, lazily.** Persist a symbol index (SCIP-style) per commit; build flow graphs on demand from entry points, not for the whole repo.
- **Incremental per checkpoint.** On each agent write: re-parse the changed file (tree-sitter), re-resolve its symbols, invalidate cached flows that include those nodes, recompute only those. Proposed latency targets to validate: under 2 s for single-file edits, under 10 s for multi-file steps.
- **Cache keys by content hash**, so branch switches and agent reverts are cheap.
- **Trade-offs to expose as settings:** depth limit, whether to include runtime evidence, whether to use LLM-suggested edges. Completeness costs latency and money; let the user choose.
- **Rendering:** WebGL or canvas rendering, level-of-detail culling, and a hard cap on visible nodes with collapse suggestions beyond it.

**Security and privacy risks and controls:**

| Risk | Control |
| --- | --- |
| Customer code stored on our servers | Encrypted volume per workspace; no staff access without the user's consent; deletion on request; LLM calls only for labels, with a no-AI mode; local runner for code that must not leave a laptop; security certification (SOC 2) before selling to companies |
| Secrets in env files, traces and logs | Redact at capture; never index `.env`; trace payload capture off by default |
| Agent running destructive commands | The agent's own permission model stays in force; we observe, we do not grant new rights |
| Runtime instrumentation of real systems | Opt-in per workspace; dev and test environments only; never production without an explicit admin policy |
| Prompt injection via code comments or README files into our LLM labels | Treat repo text as data; LLM output is labelled *suggested* and cannot create verified edges |
| Telemetry to us | Metadata only (latency, counts), off by default for code content |
| Running untrusted code and agents | One lightweight virtual machine per workspace; outbound network rules; CPU, memory and time limits; abuse detection (e.g. crypto mining) |
| Preview links reaching the wrong people | Previews private by default, signed per user and per session; sharing is an explicit action |
| Account takeover | Sign-in through GitHub or Google with two-factor, short-lived tokens, session review on the profile page |

## Experiments to validate before building

**Run six cheap experiments over roughly 8 weeks; E1, E4 and E6 decide whether to continue.** Each has a pass bar set before running it, so results cannot be rationalised afterwards. The bars below are proposed starting points.

| ID | Question | Method | Pass bar (proposed) | Kills the idea if |
| --- | --- | --- | --- | --- |
| E1 | Can flows be extracted accurately on the wedge stack? | Hand-label 30 flows across the forked repo corpus (simple store to compute-heavy simulation); compare static plus connectors against runtime traces | Edge recall at least 85%, precision at least 95% on labelled flows | Recall under 60% with no clear fix |
| E2 | Is per-checkpoint updating fast enough? | Replay recorded agent sessions (Claude Code, Codex) against the incremental pipeline | p90 update under 3 s per step on a 200k-line repo | p90 over 15 s |
| E3 | Does the behavioural diff catch what file diffs miss? | Seed 20 agent changes with hidden side effects; reviewers use file diff vs file diff plus flow diff | Clearly more side effects caught, faster review | No measurable difference |
| E4 | Do developers want this enough to pay? | 20+ interviews with agent-heavy developers, including what would make them leave their current IDE; then a clickable prototype on their own repo | 30% or more ask to use it on their own code weekly; 5 letters of intent or paid pilots | Interest only as a "nice demo" |
| E5 | Can provenance be read at a glance? | Show 5 encodings to 10 developers; test whether they spot unknown and suggested edges | 80% or more correctly identify unverified edges | Users treat all lines as fact |
| E6 | Will developers work in the canvas all day instead of their IDE? | Prototype live UI frames plus flows on 2 corpus repos; 8 developers each complete a real feature task using only the product | 6 of 8 finish without opening another IDE and say they would use it again | Most fall back to their IDE within the first hour |

**Order:** Fork the repo corpus in week 1; E4 interviews and E1 start in parallel; E2 and E5 in weeks 3–5; E3 and E6 need a working prototype, weeks 6–8.

## Recommended initial scope and first stack

**Start with web apps on a TypeScript full-stack (React / Next.js front end, Node back end, Prisma, a Redis-backed job queue), built as a canvas-first web IDE with cloud workspaces that runs Claude Code and Codex inside it.** Python back ends (FastAPI, Django) are the natural second stack. "Web app" covers a wide range, from a simple e-commerce store to a simulation running heavy maths behind a web front end, so the test corpus must span that range.

**Why TypeScript full-stack first:**

- **One language end to end.** The same type checker resolves the button, the API client and the route handler, so the hardest cross-boundary edge (UI → API) is the most tractable here.
- **Explicit entry points.** React event props (`onClick={handleLogin}`) give a clean, statically findable starting element for "select this button".
- **Concentrated frameworks.** A handful of connectors (Next.js routes and server actions, Express, Prisma, BullMQ, fetch / axios / tRPC) cover a large share of real apps.
- **Where agents are used most.** Web apps are where agent-generated changes are most common, so the review pain is densest (reasoned hypothesis to confirm in E4 interviews).
- **Runtime evidence is cheap.** Mature OpenTelemetry auto-instrumentation for Node, and test runners that are easy to wrap.

**In scope for the first prototype:**

- [ ] Live UI frames: run the dev server and show screens on the canvas; click an element to jump to its source.
- [ ] Pick an entry point from a frame, an API route or a job handler.
- [ ] Flow graph from static analysis plus connectors, with provenance tags.
- [ ] Agent panel (ACP) with full-repo context by default and optional node selection; out-of-scope edits flagged.
- [ ] Live update of frames and flows at each agent step, with *analysing* states.
- [ ] Behavioural diff: before vs after the agent session, scoped to touched flows.
- [ ] Embedded code editor (Monaco with language servers), terminal and basic git.
- [ ] Relevant tests for changed nodes, with one-click runs and pass or fail.

**Development and test corpus (forked open-source repos).** Test repos are always fully built, actively maintained public projects, never the team's or a customer's own product. Wave 1 uses seven, each chosen to stress a different part of the product:

| Repo | What it is | What it tests |
| --- | --- | --- |
| Rallly | Scheduling polls (Next.js, tRPC, Prisma) | A small, clean starting point |
| Documenso | Document signing | PDF uploads, processing and email |
| Inbox Zero | Email app | AI features and sign-in |
| Twenty | CRM | A large codebase with GraphQL and background job queues |
| Excalidraw | Collaborative whiteboard | Real-time features |
| Dub | Link management | Analytics and many API routes |
| PhET simulations | Physics simulations in TypeScript | Heavy computation behind a web UI |

Later waves pick their repos the same way when each wave starts.

**Explicitly out of scope at first:** mobile, desktop, games, embedded, multi-repo microservices, production tracing, building our own agent, an extension marketplace, a full debugger, and team collaboration.

**Delivery surface:** a web app whose main surface is the canvas: live UI frames, flow graphs and the agent panel, with an embedded Monaco editor (the editor core of VS Code) for direct code edits. Each project runs in a cloud workspace, so nothing is installed on the user's laptop. Reusing Monaco, language servers and an existing terminal component avoids rebuilding the commodity parts of an IDE. "Open in VS Code or Cursor" connects remotely to the same workspace, so trying the product never strands a developer mid-task.

## Success criteria and metrics

**The north-star metric is days per week on which the product is the developer's main IDE (no other editor used for that project).** It measures whether the product has actually replaced the IDE, not just whether the canvas impressed someone once.

| Layer | Metric | Proposed early target |
| --- | --- | --- |
| Correctness | Edge precision on labelled flows | 95% or more |
| Correctness | Edge recall on labelled flows | 85% or more |
| Correctness | Users reporting a wrong edge per 100 sessions | Falling month over month |
| Speed | p90 graph update after an agent step | Under 3 s |
| Value | Side effects caught vs file-diff-only review (E3 setup) | Clear, repeatable improvement |
| Value | Reverts or follow-up fixes after agent changes reviewed in-product | Lower than the team's baseline |
| Habit | Days per week used as the main IDE, per active developer | 3 or more |
| Habit | Agent sessions reviewed in-product per developer per week | 5 or more |
| Habit | 4-week retention of activated developers | 40% or more |
| Business | Paid pilots or teams converted from free | Set after E4 |

Targets are starting hypotheses; recalibrate after the first 20 design partners.

## Path from research to prototype to product

**Spend 8 weeks proving accuracy and demand, then build a narrow prototype with 20 design partners, and only broaden stacks after usage becomes a weekly habit.** Each phase ends at a gate; failing a gate means changing course, not pushing on.

&#91;embedded content: roadmap · 4 phases, 3 gates (phases not to scale)\]

Gates are the proposed pass bars from the experiments and metrics sections; timings assume a founding team of 2–3 engineers.

**Venture considerations:**

- **Fundraising timing.** A pre-seed or seed raise is far stronger after Gate A: real accuracy numbers plus named design partners answer the two questions investors will ask ("does it work?" and "is it just a feature?").
- **Moat.** Accumulated framework connectors, a labelled flow-accuracy benchmark, and trust built through provenance. Models are a commodity; verified cross-boundary edges are not.
- **Go-to-market.** Bottom-up adoption by individual developers and startups: a free allowance of cloud workspace hours for trying the product on public and small repos, a usage-based individual plan (more hours, bigger machines, longer backup history), then a team tier (shared canvases, PR integration, policy). Consider open-sourcing the graph schema and plugin SDK to attract ecosystem connectors while keeping the engine and the IDE proprietary.
- **Platform risk.** Stay agent-neutral (ACP plus hooks). If a single agent vendor builds this natively, neutrality across Claude Code, Codex, Gemini and others becomes the selling point.
- **Founding team.** The first hire that matters most is someone with static-analysis or compiler experience; canvas and editor UX is the second.

**From roadmap to build plan.** The four phases above are the business view. The detailed engineering sequence is the [build plan](https://claude.ai/artifact/YC3taCMtFWArQQNT4B17An): 96 phases (81 numbered + 15 lettered) across 10 stages, each about 1–2 weeks. Every phase ships a nightly build with a one-click demo project and a few "try it" steps, names the Figma screens it delivers, and is checked by recorded end-to-end tests, so progress can be seen and tested after every phase, not just at the gates.

## Coverage expansion plan: all kinds of software, one category at a time

**The end goal is that every kind of software opens and works in the product. It gets there through ten waves, each tested on forked GitHub repos before the next begins, with every earlier wave re-tested on each release.** "Works for all" means every category reaches a defined support level. It cannot mean perfect flows everywhere: dynamic code, closed-source engines and hardware behaviour will always leave some edges unknown, and the product shows those gaps rather than hiding them.

**Support levels (every project gets at least Level 1 from day one):**

| Level | What the developer gets | Requires |
| --- | --- | --- |
| 1. Basic | Opens on the canvas with the code editor, file and symbol view, a syntax-level call graph, terminal, git and the agent panel | Only a tree-sitter grammar, which exists for 100+ languages |
| 2. Structural | Type-resolved flows from entry points, behavioural diff of agent changes, relevant tests | A language server or indexer for the language |
| 3. Full | Live preview on the canvas, cross-boundary flows (UI → API → DB → jobs), runtime evidence | Framework connectors plus a preview adapter built and tested in that category's wave |

**The waves, in order:**

| Wave | Category | Repos to fork (types; specific repos chosen at wave start) | New work in this wave | What "live preview" means here |
| --- | --- | --- | --- | --- |
| 1 | Full-stack web apps (TypeScript) | Simple e-commerce store, SaaS starter with auth and payments, app with job queues, real-time chat, simulation with a web front end, a large mature product | Core engine, React / Next.js / Express / Prisma / BullMQ connectors, browser frames | Running screens in browser frames |
| 2 | Python back ends, APIs and data pipelines | FastAPI service, Django app, Celery workers, Airflow or Prefect pipeline | Python resolver, Django / FastAPI / Celery / SQLAlchemy connectors | API request playground; pipeline run graph |
| 3 | Mobile apps | React Native app, Flutter app, native Android (Kotlin) or iOS (Swift) app | Dart, Kotlin and Swift support; navigation connectors | Emulator or simulator screens as frames |
| 4 | Desktop apps | Electron app, Tauri app, Qt (C++) app | IPC connectors (main ↔ renderer, Rust ↔ JS) | Window captures as frames |
| 5 | CLI tools and libraries | Go CLI, Rust CLI, Python package, JS library | Command and public-API entry-point detectors | Terminal session recordings; API usage examples |
| 6 | Distributed and event-driven systems | Multi-service Go or Java system with Kafka or RabbitMQ, a gRPC microservice demo | Cross-repo graph, message-topic connectors, OpenTelemetry stitching | Service map with live traces |
| 7 | AI and ML systems | Model training repo (PyTorch), LLM agent app, RAG service | Notebook and pipeline support, model and tool-call connectors | Training run metrics; agent tool-call traces |
| 8 | Games | Godot project, Unity (C#) project, Bevy (Rust) game | Game-loop, scene and event-system connectors | Game view running as a frame |
| 9 | Embedded and firmware | Arduino or ESP-IDF project, Zephyr RTOS app, STM32 HAL project | Interrupt, RTOS-task and peripheral-register detectors | Simulator view (QEMU, Renode or Wokwi), serial output, optional hardware-in-the-loop |
| 10 | Systems software | Database engine, compiler or interpreter, Linux kernel module | Large-codebase scaling, C/C++ macro handling | Test-harness runs and traces |

**Process for every wave:**

1. Fork 5–8 public repos that cover the category's main technologies and use cases.
2. Hand-label 20–30 ground-truth flows across them.
3. Build the category's entry-point detectors, connectors and preview adapter.
4. Measure flow precision and recall, update speed, and preview reliability; fix until the wave's exit bar is met (proposed: Level 3 on at least 80% of labelled flows).
5. Have 3–5 developers from that category build a real feature in the product (as in E6).
6. Add the forked repos to the permanent regression suite.
7. Only then start the next wave.

**Regression rule:** every release re-runs the full corpus from all completed waves. A change that makes wave 1 web apps worse while adding wave 6 support does not ship, so coverage only ever grows.

**Project-type detection:** the product detects the type automatically (package files, framework imports, build configs) and asks the developer to confirm. Mixed projects, such as a web dashboard for firmware, load several categories' plugins at once.

**Honest limits after all ten waves:** some edges stay *unknown* (reflection, plugin loading, closed-source game engines and SDKs, hardware timing). Projects in languages or frameworks no wave covered still open at Level 1 or 2. The plugin SDK lets the community add Level 3 support for niche stacks.

## New and existing projects

**Once the forked-repo testing for a category is done, any developer can open their own existing repo of that kind or build new software of that kind from scratch, on the same canvas.** Testing on forks comes first; general availability per category follows that category's wave.

**Opening an existing project:**

1. Paste a GitHub, GitLab or Bitbucket URL, or upload a folder; the product clones it into a new cloud workspace.
2. It detects the project type and asks the developer to confirm.
3. It installs dependencies and indexes the code inside the workspace (a few minutes on a large repo, then incremental), so nothing is installed on the user's laptop.
4. It starts the dev server, emulator or simulator where the category supports it, and lays out the live frames and main entry points on the canvas.
5. Gaps are shown up front, e.g. "3 routes could not be linked to handlers" or "preview needs a `DATABASE_URL`", with the agent offering to fix them.

**Building new software from scratch:**

1. Describe the app ("an inventory tracker with barcode scanning and a daily stock report") or pick a starter template for any supported category.
2. The agent scaffolds the project; the canvas fills in live as files appear, so the first screen and its first flow are visible within minutes.
3. The developer keeps building feature by feature, directing the agent or editing directly, with every change shown in the UI frames, the flows and the behavioural diff.
4. Because the project is born inside the product, it has full support from the first commit: generated code follows patterns the connectors already understand.

**When each becomes available:**

| Capability | First available | Scope |
| --- | --- | --- |
| Open forked test repos | Prototype phase (wave 1) | Internal team and design partners only |
| Open your own existing web repo | Product phase | Wave 1 categories at Level 3; everything else at Level 1–2 |
| Build a new web app from scratch | Product phase | Starter templates plus agent scaffolding |
| Open or build any category | As each wave from 2 to 10 completes | That category moves to Level 3 |

## Weaknesses in the idea, assumptions and open questions

**The idea's biggest risk is now scope: replacing the IDE means matching a decade of editor polish before the canvas's advantages can win.** The second risk is that a well-funded AI IDE ships a "good enough" canvas. The defence is the combination no one else has (live UI, grounded full-stack flows, provenance, agent neutrality), plus reusing commodity IDE parts instead of rebuilding them.

**Weak or unrealistic assumptions in the brief:**

- **"Complete discoverable flow."** Realistic only as "complete as the evidence allows, with gaps shown". Promising completeness invites the convincing-but-wrong failure.
- **"Universal applicability."** CodeSee's shutdown cites exactly this breadth as unaffordable. Resolved: build for one kind of project first, ask the user what kind of project they have, and keep universality in the graph model and plugin interface rather than the first 18 months of roadmap.
- **"Watch the flow evolve live."** Mid-edit code is often unparseable. "Live" should mean per agent step; streaming token-level updates would add cost and flicker, not trust.
- **"Developers start outside-in."** Often true for exploration, but reviewers usually start from the change. The product needs both entry modes: from an element, and from "what did this session touch?"
- **Canvas as the main interface (decided; still the riskiest bet).** Graph views have a long record of impressing in demos and fading in daily use. Here the canvas holds the running UI and the code editor too, which gives it a stronger daily reason to exist. E6 tests this directly: if developers drift back to their IDE within an hour, the layout needs rethinking before more is built.
  - **IDE replacement is a very large surface.** Developers expect fast editing, search, debugging, git, extensions and keybindings. Reuse Monaco, language servers and existing terminal components; skip an extension marketplace at first; keep "open in VS Code or Cursor" as an escape hatch so the switch is low-risk.
  - **Switching cost is the main adoption barrier.** Most developers will try the product for agent-heavy tasks first and move fully only once it is clearly better there. Plan for a gradual switch rather than an all-or-nothing one.
- **Hosting is now part of the product.** Cloud workspaces make onboarding effortless but bring compute costs per user, abuse risk and a security bar that rises with every customer. Sleep-when-idle, prebuilt caches and usage-based pricing must be in place before the public beta, not after.

**Assumptions stated in this report (please confirm or correct):**

- [ ] Target is a venture-scale product for professional teams, not hobbyists.
- [ ] The product wraps existing agents and does not compete on agent quality.
- [ ] Cloud workspaces are acceptable for v1 because first users are individual developers and startups; a local runner follows for privacy-sensitive users.
- [ ] A founding team can cover static analysis, frontend graph UX and developer GTM.

**Open questions:**

- Who is on the founding team, and is there compiler or static-analysis experience?
- Open-source the analysis core (adoption and trust) or keep it closed (moat)?
- Pricing unit: per developer, or per reviewed agent session?
- Would Anthropic, OpenAI or Zed expose deeper agent hooks to a partner, or compete?

## Sources

- [Cognition: Windsurf Codemaps](https://cognition.com/blog/codemaps), Nov 2025
- [CodeSee on CB Insights](https://www.cbinsights.com/company/codesee) and [founder's shutdown post](https://sk.linkedin.com/in/daniel-ivanyi-16845458)
- [Launch HN: CodeViz (YC S24)](https://news.ycombinator.com/item?id=41393458)
- [AppMap on GitHub Marketplace](https://github.com/marketplace/get-appmap)
- [AI code review tools overview, 2026](https://www.startearly.ai/post/top-11-ai-code-review-tools/)
- [Qodo: AI code review in 2026](https://www.qodo.ai/blog/ai-code-review/)
- [TechRepublic on Stack Overflow 2025 survey](https://www.techrepublic.com/article/news-developer-trust-in-ai-declines/) and [ADTmag](https://adtmag.com/blogs/watersworks/2026/01/stack-overflow-survey.aspx)
- [Chakraborty et al., missing edges in JavaScript call graphs, ECOOP 2022](https://drops.dagstuhl.de/opus/volltexte/2022/16231/)
- [LLMs vs static analysis for call graphs, arXiv 2410.00603](https://arxiv.org/pdf/2410.00603)
- [Agent Client Protocol (Zed)](https://zed.dev/acp) and [ACP ecosystem overview](https://codex.danielvaughan.com/2026/06/10/agent-client-protocol-microsoft-intelligent-terminal-codex-cli-multi-agent-ide-ecosystem/)
- [Claude Code hooks documentation](https://docs.claude.com/en/docs/claude-code/hooks)
- [Onlook on GitHub](https://github.com/onlook-dev/onlook)
- [Linear: how we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Vercel Geist design system](https://vercel.com/geist)
- [Radix Colors: understanding the scale](https://radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
