# 0032 — Progressive disclosure and sequence view: semantic grouping and timeline of flows

- Status: accepted
- Date: 16 Nov 2026
- Phases: 12 and 13, grouped (owner's decisions, decisions log 15 Nov 2026)

## Context

Phases 9 to 11 connected client requests to route handlers, database reads and writes, external services, and background workers. In complex web applications (such as Twenty and Documenso), complete flows often span 60 or more nodes.

Without progressive disclosure, opening a 60-node flow presents an overwhelming wall of cards, making it difficult to understand high-level architecture at a glance. Furthermore, spatial graph layout highlights structural connectivity but does not communicate execution order or timing across synchronous and asynchronous boundaries.

## Decision

### 1. Progressive disclosure: semantic grouping (phase 12)

1. **Semantic Grouping:**
   - Nodes sharing a module, service, or functional boundary (e.g. "Validation", "Auth service", "Database operations", "Email delivery") are grouped.
   - A 60-node flow opens with **8 or fewer groups**, providing an immediate, high-level structural overview.
   - Collapsed groups render as stacked cards with an icon, title, node count (e.g. `Validation · 4`), and an expand chevron.

2. **Expand and Collapse with Pinned Positions:**
   - Expanding a group reveals the individual nodes within that group.
   - **Pinned layout:** Expanding or collapsing a group moves no other node on the canvas. Layout coordinates for outer nodes and groups remain stable, preventing layout jumping.

3. **Unknown Stubs & Completeness Pill:**
   - Honest representation of unanalyzed or external boundaries via stubs (`unknown calls`, `more calls not shown`).
   - The completeness pill at the top-left of the flow (`FlowStatus`) displays provenance breakdown (`18 edges · 11 resolved · 4 convention · 2 observed · 1 unknown`). Clicking the pill highlights weak or unresolved edges.

### 2. Sequence view: timeline of the flow (phase 13)

1. **Top Bar View Switch:**
   - The `Graph` / `Sequence` / `Code` view switch in the 40 px top bar (Figma 06, Figma 08) enables the `Sequence` option when viewing a flow.

2. **Waterfall Timeline:**
   - Reads the same flow graph into an ordered sequence:
     - **Main lane (`rowsMain`):** Synchronous request steps displayed sequentially with waterfall tracks. Without runtime measurements, bars show relative execution order with the label `"order from code; no timings yet"`.
     - **Background lane (`rowsBg`):** Async hand-offs (BullMQ, message queue, cron, events) jump to a dedicated Background section marked with a clock icon and hand-off delay label.
     - **Failure paths:** Errors and catch branches are marked with red failure indicators.

3. **Bidirectional Inspection:**
   - Clicking any step in the sequence view selects that node and opens its details in the right-hand node inspector, exactly as clicking a node on the graph canvas does.

## Consequences

- Large production flows (Twenty, Documenso, LibreChat, Rallly) open quickly and legibly with 8 or fewer initial cards.
- Developers can seamlessly switch between structural relationship analysis (Graph view) and temporal execution analysis (Sequence view).
- Real-browser walkthroughs and screenshot baselines verify both views against Figma 06 and Figma 08.
