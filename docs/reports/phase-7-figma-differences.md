# Phase 7: a flow and the node inspector beside Figma 06

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-project-flow-*`) and the catalogue's flow-node, decision-node, flow-stub and node-details stories catch any unintended change; this note is about the intended differences.

| Screen | Figma | Built |
| --- | --- | --- |
| A function's flow on the canvas | `06 · Canvas`: [figma-06.png](phase-2/figma-06.png) (generator: `flowcanvas-screens.js`) | [built-flow-dark.png](phase-7/built-flow-dark.png), [built-flow-light.png](phase-7/built-flow-light.png) |
| A function selected, its details in the inspector | `06 · Canvas`'s inspector (`llm.complete` selected) | [built-flow-details-dark.png](phase-7/built-flow-details-dark.png), [built-flow-details-light.png](phase-7/built-flow-details-light.png) |

The built screens show Documenso's `deleteFolder` as the engine reads it at the corpus pin: 11 nodes, 13 edges.

## Matches

- **Top to bottom,** each function below what calls it, orthogonal edges with small rounded corners.
- **Figma's node:** 216 px, raised surface, type icon, the name in Body strong, then `folder/file.ts:line` in Mono small (Figma writes `lib/parse.ts:7`).
- **The title row above the canvas:** the flow's name, then its edges by how they're known ("13 edges · 10 resolved · 3 unknown"), as Figma's "18 edges · 11 resolved · 4 convention · 2 observed · 1 unresolved".
- **An unknown call as an open stub** (Figma's `dispatch[type]()` with its open circle).
- **The selected node** in the accent ring; the inspector's tabs Details, Runs, Changes, Calls.
- **The minimap** bottom left and **the canvas toolbar** bottom centre.

## Differences, and why

| Figma | Built | Why |
| --- | --- | --- |
| The flow at 100%, a short straight chain | The whole flow fitted to the canvas: 53% for `deleteFolder`, which branches to 11 nodes | Real code branches. Fitting shows the whole flow at once; at 53% node text is small. **A question for the owner** (below): fit, or open at 100% on the function and let F fit |
| No decisions drawn | Decisions as small diamonds with their condition (`!folder`), outcomes on the lines ("yes") | Phase 7's Build: "conditions on branches" (ADR 0028: decisions as nodes, so a call's conditions are visible) |
| One stub per unknown call (`dispatch[type]()`) | One stub per function, "2 unknown calls"; the inspector lists them | Owner, 12 Nov 2026: one grouped stub per node. Per-call stubs come with expanding a flow (phase 12) |
| A live frame of the screen beside the flow, a background lane, the review bar's counts | None | Live frames are stage 2 (phase 15); background lanes phase 11; the review bar's counts come with agent sessions (phase 19), which the review bar says |
| Inspector: kind and name above the tabs ("AI call · LLM", `llm.complete`), the location with "observed 2 min ago" | Tabs at the top, then the name, its full path (a link) and Open code | The tabs' place is phase 5's (accepted). Nothing is observed at run time yet (phase 30), so there is no "observed" line; the full path is in the inspector because the node shows only `folder/file:line` |
| Inspector body: a prompt, model settings, runs | The function's signature, inputs, output, decisions, throws, awaits and unknown calls | Figma's selected node is an AI call (stage 3). For a code unit, the design brief's "Node inspector" lists what the code reveals, which is what's shown |
| Long names fit on one line | Long names wrap at their words (`canAccessTeam` / `Document`), and the node grows | Real names are longer than Figma's samples. Wrapping keeps the name whole and readable; ELK is told each node's real height so nothing overlaps (ADR 0028 addendum) |

Light theme: Figma's canvas is dark only. The light theme's baselines are `screens-project-flow-light-linux.png` and `screens-project-flow-details-light-linux.png`.
