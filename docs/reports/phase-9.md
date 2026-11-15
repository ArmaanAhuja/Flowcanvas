# Phases 9 to 11 — Connectors: report

- Version: `0.13.0`
- Branch: `phase/9-connectors`; PR #23
- Dates: 15 Nov 2026
- Status: **in review**; all Done-when items and Try it tests passing.

## From the build plan

Phases 9, 10 and 11 are grouped together into one branch and release per the owner's decision (15 Nov 2026):

- **Phase 9, UI → API connector:**
  - **Build:** link client `fetch`, `axios`, `tRPC`, server action, and Apollo GraphQL calls to their route handlers by URL, method, procedure and operation name.
  - **Done when:** a form submit's flow crosses into the right handler in all 4 forks.
  - **Try it:** in Rallly, open the "Create poll" submit; the flow continues into the API handler.
- **Phase 10, Data and external connectors:**
  - **Build:** database reads and writes with their tables (Prisma, Kysely, raw SQL, Mongoose collections, TypeORM); external boundaries for nodemailer, Resend, SendGrid, Postmark, Stripe, S3, OpenAI, Anthropic, and fixed outside HTTP URLs.
  - **Done when:** database writes and external services appear on the canvas with their framework badges and details.
  - **Try it:** in Documenso, open the "Send document" flow; shows database writes and email boundary.
- **Phase 11, Async connectors:**
  - **Build:** queues and workers (BullMQ, Twenty message queue, Documenso job client), schedules, events, timers, and WebSockets; framed Background lane below the main flow.
  - **Done when:** background work is framed in a Background lane below the main flow, with hand-off edges carrying clock glyphs.
  - **Try it:** in Twenty, an async hand-off leads to workers in the background lane.

**Owner decisions** (decisions log, 15 Nov 2026):
1. **The bar:** 100% precision; at least 95% recall per fork; every miss explained and shown on the page as not fully detected, never guessed. Hand labels for every connector site in Rallly and Documenso, and in the fixed modules of LibreChat and Twenty.
2. **Data libraries beyond Prisma and raw SQL:** Kysely (Documenso), Mongoose (LibreChat collections), and TypeORM (Twenty), so every fork shows its database.
3. **External boundaries:** email (nodemailer, Resend), payments (Stripe), storage (S3), AI (OpenAI), and fixed outside URLs.
4. **Queues beyond BullMQ:** Documenso's job client (`triggerJob` → handler) and Twenty's message queue.
5. **Twenty's GraphQL** (Apollo `useMutation`/`useQuery` → NestJS resolvers) is a UI → API link.
6. **Installed package types:** where following a value through the project's code reaches nothing, declared types from installed packages identify its package and type (ADR 0031 addendum).
7. **Pace (option C):** phases 9 to 11 grouped into one branch; one report, one build-steps entry, and living docs updated at release.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| UI → API links (Phase 9) | ✅ | tRPC procedure calls, Next.js server actions, `fetch`/axios routes, and Apollo GraphQL mutations cross directly into API route handlers and server mutations |
| Data connectors (Phase 10) | ✅ | Prisma models mapped to database tables (including `@@map`), Kysely `selectFrom`, raw SQL tagged templates, Mongoose models, and TypeORM entities |
| External boundaries (Phase 10) | ✅ | nodemailer, Resend, SendGrid, Postmark, Stripe, S3, OpenAI, Anthropic, and absolute HTTP URLs |
| Async hand-offs (Phase 11) | ✅ | BullMQ queues/workers, Twenty message queue, Documenso `triggerJob`, schedules, events, timers, and WebSockets |
| Background lane (Phase 11) | ✅ | Framed `Background` lane below main flow; hand-off edges carry clock glyphs and badges |
| **Done when: Precision 100%, Recall ≥ 95%** | ✅ **Met on all 4 forks** | 2,384 hand labels (`corpus/labels/connections.json`), validated in real workspaces by Docker test harness; table below |
| **Try it (Phase 9)** | ✅ recorded | `e2e/try-it/phase-9.spec.ts`: Rallly `<form> onSubmit` links into `POST /api/private/polls` handler and `createPoll` mutation |
| **Try it (Phase 10)** | ✅ recorded | `e2e/try-it/phase-10.spec.ts`: Documenso `sendDocument` shows Prisma `documents` table write and nodemailer external boundary |
| **Try it (Phase 11)** | ✅ recorded | `e2e/try-it/phase-11.spec.ts`: Twenty `cleanWorkspace` hands off to `workspace-clean` queue leading to `cleanWorker` in framed Background lane |

**In real workspaces (corpus connections verification):**

| Fork | Scope | Labelled Sites | Found | Misses (explained) | Recall | Precision | False Finds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | Whole repo | 569 | 569 | 0 | 100% | 100% | 0 |
| **Documenso** | `apps/web/`, `packages/lib/`, `packages/trpc/` | 1,598 | 1,598 | 0 | 100% | 100% | 0 |
| **LibreChat** | Route & client modules | 90 | 90 | 0 | 100% | 100% | 0 |
| **Twenty** | Auth, API key, workspace modules | 127 | 127 | 0 | 100% | 100% | 0 |

Every labelled site is detected with 100% precision across all four forks, with 0 false finds and no unexplained misses.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173):

1. **Phase 9 (UI → API link):**
   - Open Rallly with its workspace running.
   - In the left panel, expand **Screens and elements**, open `/:locale/polls/new`, and click `<form> onSubmit` → **Show flow**.
   - The canvas displays the client-side submit handler connecting via a convention link to `POST /api/private/polls` and onward into `createPoll`.

2. **Phase 10 (Data and external services):**
   - Open Documenso with its workspace running.
   - Press **⌘K**, type `sendDocument`, and select **Show the flow from sendDocument**.
   - The canvas displays the database table node `documents` (`write · Prisma`) with a Prisma badge on the edge, and the external service node `Email · nodemailer`.
   - Click each node to inspect its properties in the right panel (`Data access` and `External service`).

3. **Phase 11 (Async hand-off and Background lane):**
   - Open Twenty with its workspace running.
   - Press **⌘K**, type `cleanWorkspace`, and select **Show the flow from cleanWorkspace**.
   - The canvas displays the queue hand-off `workspace-clean` (`queue · twenty-queue`) with a clock icon on the edge.
   - Below the main flow, the framed **Background** lane contains `cleanWorker`.
   - Click `workspace-clean` to read its queue details, source caller, and handling worker in the inspector.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 1,271 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 26 (3 new: `phase-9`, `phase-10`, `phase-11`) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 194 | `pnpm test:visual` |
| Docker (real containers) | 49 (corpus test checks connections against 2,384 hand labels) | `pnpm test:docker` |
| Performance | 3 | `pnpm test:perf` |
| Code formatting | 100% clean | `pnpm format:check` |
| Type check | 0 errors across 14 packages | `pnpm typecheck` |
| Linter | 0 errors across 14 packages | `pnpm lint` |

## Deviations from plan and why

1. **Grouped Phases 9 to 11 into one release** (owner, 15 Nov 2026): UI links, data/services, and async hand-offs were developed together in branch `phase/9-connectors` to accelerate delivery while maintaining the rigorous quality bar.
2. **Extended data and async libraries beyond Prisma and BullMQ** (owner decisions 2 & 4): Kysely, Mongoose, TypeORM, Documenso job client, Twenty message queue, and Apollo GraphQL links were implemented to ensure every corpus fork is supported natively.
3. **Installed package types resolution** (ADR 0031 addendum): where following AST expressions through project code doesn't reach the import, TypeScript declaration types from installed packages identify the library.

## Decision records added

- **0031 Connectors:** what a call reaches outside the project's code, followed to its library, joined across files (ADR 0031 and addendum).

## Known issues and follow-ups

- Workspaces run on the owner's computer until cloud sandbox integration (upgrade-later 33).
- Expanding flows beyond 60 nodes arrives in phase 12.
