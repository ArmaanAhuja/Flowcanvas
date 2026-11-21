# Phases 12 and 13 — Progressive disclosure and the sequence view: report

- Version: `0.14.0`
- Branch: `phase/12-progressive-disclosure`; PR #24
- Dates: 16 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

Grouped into one branch, report and acceptance (owner, 15 Nov 2026), each phase's *Done when* and *Try it* proven on its own.

- **Phase 12, Progressive disclosure**
  - **Build:** semantic grouping, expand and collapse, *unknown* stubs, completeness pill per flow, pinned positions.
  - **Done when:** a 60-node flow opens as 8 or fewer groups; expanding one moves no other node.
  - **Try it:** open Twenty's largest flow; expand a group; read the completeness pill.
- **Phase 13, Sequence view**
  - **Build:** timeline of the same flow: order, async hops, retries, failure paths; Graph / Sequence switch.
  - **Done when:** the same flow reads correctly in both views.
  - **Try it:** switch to Sequence on any flow; compare with Figma 08.

**Owner decisions** (decisions log, 16 Nov 2026): the draft that came in was checked against the plan before this report; "go ahead for all 4": groups named from the code (folders and kinds, never an inferred category), the pinned layout rebuilt and checked on every node, the sequence view in the code's order, the baselines regenerated and each read.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| **Phase 12 · Done when:** a 60-node flow opens as 8 or fewer groups | ✅ | `layout.test.ts` on the engine's own 60-node `sendDocument` flow (Documenso); `grouping.test.ts`; walkthrough `phase-12.spec.ts` on Twenty's largest flow (`PartnerProfilePage`, 60 nodes and 96 more not shown): 6 groups and 2 nodes besides the root |
| **Phase 12 · Done when:** expanding one moves no other node | ✅ | `layout.test.ts`: opening each group of `sendDocument` in turn, and two at once, leaves every other node's position and size exactly as it was; `phase-12.spec.ts`: every node's box on the screen within 1 px before and after opening `src/platform` |
| **Phase 13 · Done when:** the same flow reads correctly in both views | ✅ | `SequenceCanvas.test.tsx`: every node a row once, in the code's call order (not breadth first), nested, branches and failure paths from the code's edges only, a Background group per hand-off, nothing timed; `phase-13.spec.ts` on Twenty's `EmailService.send` (16 nodes, 16 steps; the worker in its Background group; a row opens its node in the inspector) |
| **Phase 12 · Try it** | ✅ recorded | `e2e/try-it/phase-12.spec.ts` |
| **Phase 13 · Try it** | ✅ recorded | `e2e/try-it/phase-13.spec.ts`; compared with Figma 08 by eye (below) |

**How the forks' flows group** (each fork's graph at its pin):

| Flow | Groups (and nodes on their own) |
| --- | --- |
| Twenty, `PartnerProfilePage` (largest) | `src/platform` 18, `src/partners-marketplace` 17, `sections/menu` 12, `src/ui` 5, `src/client-brief` 3, `twenty-website/src` 2; on their own: the root, `!partner`, `isDefined` |
| Documenso, `sendDocument` | `lib/server-only` 27, `lib/utils` 14, Tables 6, `lib/types` 4, `lib/constants` 3, `packages/lib` 3; on their own: the root, `materializeTspAnchorsForEnvelope`, `internal.execute-webhook` |
| Rallly, `/new`'s `Page` | `features/poll` 21, `ui/src` 14, `src/features` 13, `(optional-space)/new` 4, `src/lib` 3, `src/i18n` 2; on their own: the root, `Link`, `mutation polls.make` |

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), with Twenty's corpus project open and its workspace running:
1. ⌘K, `PartnerProfilePage`, **Show the flow from PartnerProfilePage**: 8 or fewer groups and nodes, named by their folders.
2. Click `src/platform · 18`'s header: its members appear in its frame; nothing else moves. Click it again to close it.
3. Press the completeness pill (top left): the weak edges stand out.
4. Switch to **Sequence** in the top bar: the same flow in order; click a row to read its node in the inspector.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | see `docs/RUN-AND-FEATURES.md` | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 28 (2 new, on the engine's own flows) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | see `docs/RUN-AND-FEATURES.md` | `pnpm test:visual` |
| Docker (real containers) | 49, unchanged: the engine didn't change | `pnpm test:docker` |

**Figma.** Figma 08 (sequence): the same table, header, Background group with a clock, dashed bars for order from code and the legend; differences in `docs/reports/phase-12-figma-differences.md`.

## Deviations from plan and why

1. **Grouped** (owner): one branch, report and acceptance for phases 12 and 13.
2. **The draft was rebuilt** before this report (decisions log, 16 Nov 2026; ADR 0032 addendum): its groups were guessed categories, its "pinned" layout drew edges into empty space, and its sequence view was breadth first with failures guessed from names.
3. **Retries** (phase 13's *Build*) aren't shown: the code doesn't say how often a call is retried; they arrive with observed runs (phase 29), as the design brief's "stacked bars".
4. **An open group is drawn over the canvas** (design brief: "Expanding pushes nothing else around"): it can cover what's next to it until it's closed.

## Decision records added

- 0032 progressive disclosure and the sequence view (with its addendum of 16 Nov 2026).

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **An open group covers its neighbours** while open (above).
- **Flows show 60 nodes;** groups hold them, and what's further is still opened from its own flow.
- **Retries** arrive with runs (phase 29).

**Upgrade-later review:** re-read; no item's trigger was reached in these phases.

## CI

The draft PR (#24) runs CI on every push; the close's run is named in `docs/build-steps.md`'s step 12.1 once green.

## Next phase preview

**Stage 2, live frames** (phases 14 to 18): the running app on the canvas, beside its flows.
