# 0028 — Flows: decisions in the graph, flows from the latest snapshot, layout with ELK in a Web Worker

- Status: accepted
- Date: 12 Nov 2026
- Phase: 7, step 1 (spike)

## Context

Phase 7 builds *a downstream flow from any function; ELK layout; click a node to open its code; conditions on branches; node inspector showing every detail the code reveals*. *Done when:* flows for 10 functions render correctly and every node opens the right line.

The owner's decisions (decisions log, 12 Nov 2026): flows open from the right-click menu, ⌘K and the Calls tab; up to 60 nodes, then an honest stub; one grouped stub per node for unknown calls; 10 Documenso functions labelled by Claude. The design brief ("Flow graph view"): left to right; decisions as small diamonds with condition labels on their outgoing edges; failure paths as thin red edges; a completeness pill.

Phase 6's graph (ADR 0027) holds code units and call edges; its vocabulary reserved decision nodes and branch edges for this phase.

## The spike (12 Nov 2026)

**Layout.** `elkjs` 0.11.0, the layered algorithm, left to right, on flow-shaped graphs (a tree of calls, some shared callees, about one node in eight a decision), in Node 26 on the laptop:

| Nodes | Median | Worst of 5 |
| --- | --- | --- |
| 60 (the owner's cap) | 63 ms | 96 ms |
| 200 | 133 ms | 148 ms |
| 500 | 337 ms | 383 ms |

**Conditions.** Walking up from each call site to its function and collecting what it sits under works on real code. On Documenso's `sendDocument` (55 call sites), every condition read correctly, e.g. line 235: `if envelope.internalVersion === 2 › if !recipient`; calls inside callbacks (`.map(…)`) keep their outer conditions. Some conditions are long (`isTspEnvelope(envelope) && signingOrder === DocumentSigningOrder.SEQUENTIAL`), so labels need cutting.

**Licence.** `elkjs` is EPL-2.0 or GPL-3.0-or-later. EPL-2.0 is a weak copyleft: using the library unchanged in our product is allowed; changes to its own files would have to be published. We don't change it.

## Decision

### 1. Decisions are nodes in the graph

The graph pass (ADR 0027) also records, for each function, the constructs that guard its calls:
- **`if` / `else`:** a decision named by its condition; outcomes "yes" and "no".
- **A ternary, `&&`, `||`, `??`:** the same, named by the condition (`a && f()`: "yes"; `a || f()`, `a ?? f()`: "no").
- **`switch`:** a decision named by the switched expression; one outcome per case ("case 'DRAFT'", "default").
- **`try` / `catch`:** a decision "on error"; calls in the `catch` are its outcome "error", drawn as a failure path. Calls in the `try` block aren't conditional.

Only constructs that guard at least one call become decisions. A decision's identity is its function's id and its order in the function (`…#sendDocument?3`), its place the line of its condition.

**Edges:** a `branch` edge from the function (or the enclosing decision, when nested) into the decision, with no label; and a `branch` edge from the decision to each guarded call's target (a node, or the call's text when unknown), labelled with the outcome, with the call's provenance and lines. **Call edges stay exactly as they were**: callers and callees (phase 5, phase 6's labels) don't change; a flow draws a guarded call through its decision instead of directly.

This adds a `label` to edges: the snapshot format goes to version 2 (a version 1 snapshot is replaced by the next pass).

### 2. Flows are built from the latest snapshot, in the engine's main process

- **From a function's node:** breadth-first over its outgoing calls (through their decisions), counting nodes, until 60. Where the flow is cut, one stub node: "N more calls not shown".
- **Unknown calls:** one grouped stub per node, "N unknown calls", listing them.
- **The completeness pill's counts** come with the flow.
- **No TypeScript needed:** the latest snapshot is kept decoded in memory with an index by node, so a flow is milliseconds. When the graph is being brought up to date, the flow says it's from the last version.

### 3. The inspector's details come from TypeScript, in the worker

Like the Calls tab's answers (ADR 0026): for a code unit at a place, its signature, typed parameters and return type, its decisions and their conditions, what it throws and awaits, its unresolved calls, and its callers. "Side effects", as the plan's table names them, are what the code shows: thrown errors, awaited calls, unresolved calls, and writes to module-level state. Data access and external services arrive with their connectors (phase 10).

### 4. Layout in the page, in a Web Worker

ELK runs in a Web Worker in the page (CLAUDE.md section 7: never the UI thread), loaded only when a flow is opened. Positions are computed per flow; pinning them across changes is phase 22.

## Options considered

- **Conditions computed when a flow is asked for:** no format change, but every flow would need TypeScript programs built (seconds on a large project), where the graph pass already walks every call.
- **Rewriting call edges to start at decisions:** simpler flows, but callers would become decisions, breaking the Calls tab and phase 6's labels.
- **Layout in the engine:** the page would wait on the workspace for positions it can work out itself in 63 ms.
- **dagre instead of ELK:** smaller, but unmaintained, and the plan names ELK.

## Consequences

- **A flow opens in milliseconds** from the snapshot, plus about 0.1 s of layout.
- **Snapshots grow** by the decisions and branch edges; measured in step 2 against the 1 s budget.
- **Flows show the last version while the graph is being brought up to date,** and say so.

## Addendum: steps 2 and 3 (13 Nov 2026)

**Loading stays under 1 s with decisions.** Decisions made Twenty's graph 34,169 decisions and 84,338 branch edges larger, and its snapshot took 1,718 ms to load on the laptop (unzipping 341 ms, parsing 440 ms, checking against the schema 1,051 ms, the hash 56 ms): over phase 6's 1 s. Three changes:
- **Checked once, before it's saved:** the worker checks each graph against the schema before encoding it; a graph that fails is a failed pass and is never stored. Loading checks the stored bytes against their SHA-256 (the version's name) and trusts them. A changed byte is refused ("The stored version of the graph is damaged."), however it decodes.
- **A table of paths** in the encoding: a node's id and place refer to it, rather than repeating the path (graph format 2).
- **zstd instead of gzip** (Node's own `zlib`): Twenty's stored copy is 4.5 MB.
Twenty now loads in 724 ms on the laptop and 225 ms on CI's runner; the four held forks load in at most 225 ms and save in at most 129 ms on CI.

**Flows (step 2).** `buildFlow` in `@flowcanvas/graph-model` (pure). Out of a code unit it follows its branches into decisions and its calls, less the lines a decision guards (those are drawn through the decision); out of a decision, its branches. Breadth-first to 60 nodes; `cut` says which shown nodes lead to nodes not shown, and `hidden` how many. Unknown calls are grouped per node (the first 20 listed, `total` counted). Edges keep their first 10 lines (`sites` counts them all). The completeness pill counts edges that reach calls, not edges into decisions. The engine keeps the latest version decoded with an index (about 60 MB for Twenty) and builds a flow in under 1 ms (Documenso).
- **Where a flow starts:** a function's name (from ⌘K or the Calls tab) is found in the graph by its place; anywhere else, the worker names the code unit with the pass's own ids and rule for whose code is whose. A constant that's only called isn't a unit of its own, and a constant's name gives the function it holds.
- **Too large to send:** an answer must fit one engine message (256 KB). A flow over three quarters of that is built again with half the nodes until it fits, and says so ("Shown with up to 30 nodes…").
- **Kept honest:** `current` is false while the graph is catching up with changes; the flow is from the last version, and the page says so.
- **Timing:** from a name, milliseconds (CI: at most 15 ms on Rallly and Documenso). From inside a function, the first question about a package builds its programs: 1.2 s on LibreChat, 7.9 s on Twenty, on CI. That's the Calls tab's cost too (phase 5), and a flow waits on TypeScript with the same 90 s backstop.

**Details (§3, step 2).** A `details` question, like the Calls tab's: signature, typed inputs and output, async, exported (among what its module exports, `export { name }` included); decisions with their conditions and outcomes; thrown errors; awaited calls; unknown calls (the graph's own unknown edges for the unit); writes to variables declared at a file's top level. Its own code only: a nested function is its own node. Each list keeps its first 50 and counts them all. **Callers aren't repeated in details:** the page asks the `callers` question the Calls tab already uses.

**The API (step 3).** `GET /api/projects/:id/workspace/index/flow` and `…/index/details`, with a place (`path`, `line`, `column`): the owner's only, while the workspace runs, and counted as activity. Both are checked in the control plane and the host with exact shapes and bounds, like every answer from inside a workspace.

**Found on the way: search during a pass.** Two CI runs failed phase 4's Rallly check, one search under 100 ms, at 118 and 151 ms. Since phase 6 the graph pass starts as the index becomes ready, and a workspace's 2-CPU quota can pause every thread in it, the engine's main thread included. Measured in a 2-CPU container: with one busy worker, search's p95 is 9 to 14 ms and its worst 61 to 67 ms; with none, its worst is 27 ms. A lower priority for the worker's thread doesn't help (the quota is the container's, not the thread's). The decisions log (9 Nov) sets the engine's p95, so the test now takes the p95 of 19 searches: 21 ms on CI. Giving analysis a CPU share of its own is in `docs/upgrade-later.md`.
