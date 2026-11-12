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
