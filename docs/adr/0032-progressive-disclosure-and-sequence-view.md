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

## Addendum (16 Nov 2026): checked against the plan, and corrected

The first build of this decision was checked before it was reported (decisions log, 16 Nov 2026). Groups were named by matching folder names against invented categories ("Validation" for every decision, "Jobs & queues" for any folder starting with `email`, Twenty's folders hard-coded); opening a group moved nodes back to earlier positions while keeping ELK's edges for the new ones, so edges ended in empty space; the sequence view ordered steps breadth first and called a step a failure when its name contained "error". **Owner:** "go ahead for all 4". What replaced them:

- **Groups named from the code** (`semanticGrouping`, graph-model): functions by their folder, from the top down: each lane's functions start in their deepest shared folder, and the largest group is split into its subfolders (what's directly in it staying) while the groups stay within 8; when not all subfolders fit, the largest that do are split off and the rest stay in the folder, under its name. Tables, outside services and hand-offs are each a group of their kind; a decision is in its function's group; the root is always on its own, and so is a group of one. Group ids are `group:<lane>:<key>`, stable across layouts. On the forks: Twenty's largest flow opens as `src/platform · 18`, `src/partners-marketplace · 17`, `sections/menu · 12`…; Documenso's `sendDocument` as `lib/server-only · 27`, `lib/utils · 14`, `Tables · 6`…
- **Opening a group moves nothing else** (`layoutFlow`, web): the base layout is the flow with every group closed, laid out from the flow alone, so it's the same whatever is open. An open group's members are laid out on their own and drawn in a frame at its card's place, over the canvas (design brief: "Expanding pushes nothing else around"); edges into it are drawn to its members as placed, not along routes made for the closed card; its open ends become its members'. The canvas re-centres only for a new flow, not when a group opens, so nothing moves on the screen either. Each layout is kept by version, root and what's open. The completeness pill changes how edges are drawn, never the layout.
- **The sequence view** (`flowToSequence`, web; `SequenceView`, ui): depth first from the root in the order of each function's call lines, each node once; nested by depth; without timings each bar covers its calls' rows, as a trace's parent span; a decision's outcome is said on the row it leads to; a failure path is only an `error` (catch) branch; open ends are rows; each hand-off's work is its own Background group after the main steps; no time axis until spans are measured (phase 29). Retries aren't known from the code: they arrive with observed runs.

