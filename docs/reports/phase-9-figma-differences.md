# Phases 9 to 11: Connectors beside Figma 06 and Design Brief

For the owner's review by eye. Figma 06 is the layout reference; Graphite design tokens outrank it on all visuals (CLAUDE.md section 2).

| Screen | Built (the engine's own flows from the forks) |
| --- | --- |
| Documenso's signing email runner: its tables and its email, the email inspected | `e2e/visual/__screenshots__/screens-project-flow-data-and-email-{dark,light}-linux.png` |
| Twenty's email queue: the hand-off with its clock, the worker in the Background lane, the hand-off inspected | `e2e/visual/__screenshots__/screens-project-flow-background-lane-{dark,light}-linux.png` |

## Matches

- **Data access nodes:** Database icon from Graphite (`Database` from Lucide), styled with `kind: "data"`, showing table name and operation under the title (e.g., `write · Prisma`).
- **External service nodes:** Globe icon from Graphite (`Globe` from Lucide), styled with `kind: "external"`, showing service package (e.g., `nodemailer`, `Stripe`).
- **Async hand-off nodes:** Layers icon (`Layers` from Lucide), styled with `kind: "queue"`, showing queue/job name and library.
- **Convention edges:** Framework glyph badge (e.g., `Prisma`, `tRPC`, `job-client`) rendered along the edge path.
- **Hand-off edges:** Clock icon (`Clock` from Lucide, 12 px) indicating asynchronous delegation.
- **Background lane:** Framed lane rendered below the main flow containing worker functions that handle dispatched jobs.
- **Inspector panels:** Specialized inspector views for Data access, External service, and Async hand-offs showing resolved facts and links to code locations.

## Differences, and why

| Design Brief / Figma | Built | Why |
| --- | --- | --- |
| Generic service stubs | Dedicated node kinds: `data-access`, `external-boundary`, `async-handoff` | ADR 0031: distinct node semantics allow clear visual differentiation and precise inspector facts |
| Solid edge arrows for all calls | Convention edges with framework badges; hand-off edges with clock glyphs | CLAUDE.md rule 4: every edge indicates its provenance and nature; async hand-offs clearly indicate non-blocking boundaries |
| Single vertical flow column | Main flow column above with framed Background lane below | Build plan phase 11 & ADR 0031 §5: background worker execution is visually decoupled from synchronous request flows |
| Presumed complete discovery | A table, service or hand-off not fully detected says so under its name ("· not fully detected"); the inspector says why | CLAUDE.md rule 3: what can't be worked out is said, never guessed |
| A flow that fits the screen | Documenso's signing email runner (60 nodes) fits only at 9% | Grouping and expanding flows is phase 12 |
