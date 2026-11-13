# Decisions log

Answers to open questions raised during the project, with dates. Check here before asking a question that may already be settled. Engineering decisions with options and consequences go in `docs/adr/`; this log records product and project decisions made by the project owner.

## 26 Oct 2026: answers to the kick-off questions

### A1. Colours: muted palette is final

The muted palette is correct and final. The Graphite doc was outdated on colour only (now updated). Until the Figma variables can be read directly, use these values (dark theme):

| Group | Tokens |
| --- | --- |
| Surfaces | canvas #0B0C0E, panel #111317, raised #181B20, hover #1E2228, selected #252A31, inverse #E6E8EB |
| Borders | subtle #2C323A, control #383F49, strong #4A525E |
| Text | primary #EDEFF2, secondary #A3AAB5, tertiary #6B7380, on-accent #0B0C0E |
| Accent (steel blue, selection and focus only) | solid #7487AD, hover #8496BB, tint #182031, ring #34405A, text #A9B7D3 |
| States (solid / tint / text) | added #6E9C82 / #18221D / #9FC2AD · modified #B39B6B / #24211A / #D2BE93 · removed #B07473 / #261B1B / #CFA09F · affected #8C83B0 / #1F1D29 / #B5AED3 · outside selection #A97A96 / #251C22 / #C9A3BA |
| Edges | observed #A3AAB5, default #6B7380 |
| App preview (inside live frames) | surface #FFFFFF, ink #1F2328, muted #6E7781, line #E5E7EB, brand #1F2328 |

- Primary button: inverse background (#E6E8EB) with dark text (#0B0C0E). Never a blue button.
- Type: Inter (UI) and JetBrains Mono (code). Display 24/32 600, Title 20/28 600, Heading 15/22 600, Body 13/20 400, Body strong 13/20 500, Small 12/16 400, Small strong 12/16 500, Caption 11/14 500, Mono 12/18, Mono small 11/16.
- Radii 4 / 6 / 8 / 10. 4 px spacing grid. Sentence-case labels, no ALL CAPS.
- Light theme is not defined in the muted palette yet: to be proposed in phase 1a for approval.

### A2. Design brief

Graphite (as corrected) and the Figma screens override the design brief on visual values. The brief stays the reference for behaviour.

### A3. Tokens and Figma

Build `tools/figma-tokens` to read a Figma variables JSON export. Until then, use a hand-written seed JSON with the A1 values, recorded in a temporary ADR.

- Figma file: https://www.figma.com/design/aV9vPto305pKFPlvWQOBX8
- Generator scripts (`flowcanvas-screens.js`, `flowcanvas-prompting-screens.js`, `flowcanvas-cloud-screens.js`): their `HEX` maps and layout values are an exact fallback reference.

### A4. Cloud-first copy

Rewrite any local-first copy to cloud-first wording everywhere:

- Keys live in the encrypted secrets vault (not the OS keychain).
- "Local analysis only" becomes a "Self-hosted models only" option.
- "Open folder" becomes "Upload folder" / "Clone from URL".

### A5. Layout

The Figma file is the layout reference: a 40 px top bar (project, branch, Graph / Sequence / Code switch, search, workspace status, share, avatar) and a 40 px review bar. Where the prototype screenshots in `docs/reference/screens/` differ, follow Figma, and list the differences for the owner at phase 2.

### A6. Hosting

- Code: GitHub, https://github.com/ArmaanAhuja/Flowcanvas (moved from `ArmaanAhuja-7777/Glassbox` on 31 Oct 2026; see that entry)
- Web app: Cloudflare Pages, with per-PR previews
- Control-plane stub: Fly.io
- Prefer free tiers for now.
- The owner sets up each account and connection themselves; Claude teaches how.

### A7. Naming

- The product name is not final (shortlist: Throughline, Cutaway).
- Use the working name **Flowcanvas** and the `@flowcanvas/*` package scope, so a rename later is mechanical.
- Never use "Glassbox" in code or package names (trademark conflict). The folder and repository name don't matter.

### A8. Test-repo licences

Private forks in the owner's org, pinned to exact commits. They are used only inside workspaces and never redistributed until licences are checked (Rallly and Documenso are AGPL).

### A9. Phase count and scope

- The build plan's 96 phases (81 numbered + 15 lettered) are authoritative.
- Keep following the build plan as written. Don't change scope based on the feasibility (research) report unless the owner says so.

### Working mode (same date)

Teaching mode: the owner types code, config, tests and CI by default; Claude teaches in chat, plans and reviews, and does a step itself when asked. See section 4a of `CLAUDE.md`.

## 26 Oct 2026: branch protection (phase 1, step 10)

The free GitHub plan can't protect branches on private repositories. Decision: **option 3**. CI runs on every PR, and we merge only when it's green and never push to `main` directly. Upgrade to GitHub Pro later. Tracked in `docs/upgrade-later.md` (item 1), which lists every deferred upgrade with its trigger.

## 26 Oct 2026: repository made public; Actions still blocked (phase 1, step 10)

GitHub Actions wouldn't run: on the private repository every run ended in `startup_failure`, even a one-line workflow. The owner made the repository **public**. Runs then *started*, but every job failed with GitHub's annotation "The job was not started because your account is locked due to a billing issue". The lock is account-wide, so visibility doesn't affect it.

Decision: **resolve the billing lock later and continue building now.** Until then:
- CI checks run locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.
- Steps 11 and 12 use paths that don't need GitHub Actions (Cloudflare Pages' own Git integration for PR previews; Fly.io deploys from the owner's machine).
- Phase 1 can't be fully accepted until the workflow runs green on GitHub.

The repository stays public for now; making it private again is a separate choice. While public, no secrets, personal or account details go into it, and forks of AGPL test repos stay out of it (decision A8). Tracked in `docs/upgrade-later.md` (items 8 and 9).

## 27 Oct 2026: light theme approved (phase 1a, step 2)

The owner approved the proposed Graphite light theme: same 40 colour roles as dark, all WCAG AA pairs passing (enforced by tests), and a **near-black primary button with off-white text** in light (the inverse of dark's off-white button). Values: `packages/tokens/source/color.light.tokens.json` and the Graphite doc's "Light theme" section.

## 27 Oct 2026: caption colour, `text/muted` (phase 1a, step 4)

axe-core in Storybook found that captions in `text/tertiary` fail WCAG AA (4.08:1 dark, 3.26:1 light; text needs 4.5:1). The owner chose **option B**: a new token **`text/muted`** (dark `#818995`, light `#666E7A`, ≥ 4.5:1 on canvas, panel, raised and hover) for captions, section labels and metadata. `text/tertiary` is **non-text only** from now on (icons, edges, placeholders, disabled marks). Metadata on selected rows uses `text/secondary`. Enforced by the token contrast tests.

## 27 Oct 2026: Input and Toggle details (phase 1a, step 6)

Engineering decisions, made within the design rules:
- **Input radius 6 px**, following Graphite ("6 nodes and inputs"), which ranks above the Figma screens (they draw 4 px).
- **Placeholders use `text/muted`** (4.9:1 dark, 5.2:1 light). Placeholders are text, so `text/tertiary` (3.6 / 3.35) would fail AA. This tightens the 27 Oct caption decision: `text/tertiary` is never used for any text.
- **Toggle off knob uses `text/secondary`** (Figma: tertiary), so the knob that shows the state has ≥ 3:1 against its track (6.2 dark, 4.9 light; tertiary would be 3.0 / 2.75).

Input border: owner chose **option A** (keep `border/control`, 1.6:1). Every input has a visible label and the focus state passes. Logged for an accessibility review before public beta (`docs/upgrade-later.md` item 15).

## 27 Oct 2026: headless primitives (phase 1a, step 8)

Engineering decision (ADR 0008): **React Aria Components** for menus, tooltips and future overlays, after testing React Aria, Radix and Base UI under the production CSP. React Aria's one injected `<style>` is pre-empted by `preventReactAriaStyleInjection()` plus the same rule in `global.css`. Also recorded: ADR 0007 (`@flowcanvas/ui` is consumed as source).

Popover shadow per theme (owner approved, 27 Oct 2026): dark keeps `0 8 24 rgba(0, 0, 0, 0.4)`; light uses `0 8 24 rgba(16, 24, 40, 0.12)`, a soft slate tint, because the dark value looked heavy on light surfaces. `shadow.popover` moved from the base tokens into both theme files.

## 27 Oct 2026: Flow node (phase 1a, step 9)

Engineering decisions, made to keep accessibility and the 4 px grid; step 10 compares the result with Figma:

- **Icons:** Lucide via `lucide-react` (ADR 0009), with one icon per node type.
- **State model:**
  - `change` (added, modified, removed, affected, outside selection), `status` (failing, analysing) and `selected` are three independent props. Figma has them as nine separate variants, but in the product a node can be modified *and* failing *and* selected.
  - Each shows its own tag.
  - The state bar and border follow the change; a failing node with no change gets the clay bar, as in the Figma "Failing" variant.
- **Dimming:**
  - Removed and analysing nodes dim the title to `text/secondary` instead of setting opacity 0.55 (Figma) or 0.4 (Graphite motion table). Opacity would drop the location text below 4.5:1.
  - Removed nodes keep the strikethrough and the "− removed" tag.
  - `opacity.ghost` stays in the tokens for canvas-level ghosting, which needs a contrast check when it's used.
- **Location text:** uses `text/muted`, not Figma's tertiary, following the 1a.4 caption decision.
- **Spacing follows Figma exactly** (corrected in step 10, after the screenshot comparison showed 1–2 px offsets):
  - 9 px vertical and 10 px right padding inside the 1 px border, 12 px left, 10 px between icon and text.
  - The node is 216 × 56 px, as in Figma. Step 9 had snapped these to the 4 px grid, which moved the text by 1–2 px.
- **Tags sit top-right beside the title, as in Figma** (corrected in step 10). The title wraps in the space left; two tags (change and status) stack. Step 9 had wrapped tags below the title instead, which made the "outside selection" variant differ from Figma. A single very long identifier now breaks mid-word, as Figma does.
- **Selection outline is drawn inside the edge** (1 px border plus a 0.5 px inset ring, like Figma's 1.5 px inside stroke), with the 3 px accent-tint halo outside.
- **Tag symbols** ("+", "~", "−") are hidden from screen readers, which hear "modified" rather than "tilde modified".
- **Left out on purpose** (each belongs to the phase that adds the behaviour; no placeholder features):
  - hover quick actions
  - edge ports
  - framework or timing badges
  - the "new node appears" animation

## 27 Oct 2026: visual tests and the Figma comparison (phase 1a, step 10)

Engineering decisions:

- **Two kinds of visual test:**
  - The **Figma comparison** (`e2e/visual/figma.spec.ts`) checks each Tag, Button and Flow node variant against the owner's Figma exports (dark, 2x), with a mismatch budget per variant. It also writes a side-by-side report.
  - The **catalogue regression** (`e2e/visual/catalogue.spec.ts`) checks every story in both themes against approved baselines of our own rendering, plus axe (WCAG 2.0–2.2 A/AA).
- **Mismatch budgets** were measured, then set just above the measurement:
  - **Floor, 2–4%: font rasterisation.** Figma draws Inter 3; we self-host Inter 4, which has slightly different glyph widths. A 1–2 px layout error measures 5–15%, so it fails.
  - **Higher budgets cover deliberate differences:**
    - location text in `text/muted` (contrast)
    - removed-node strikethrough and no opacity dimming (Graphite, contrast)
    - Figma's selected node being 57 px tall
    - Figma's bordered button export being 2 px wider
- **The selection halo is excluded from the comparison.** Figma's component export reserves room for it but draws it transparent (spread on a drop shadow does not export). Graphite and Figma screen 06 show it, and the catalogue baseline covers it.
- **Components that exist only inside Figma screens** (Input, Toggle, Tabs, Panel, Menu) are compared by eye in the report. Their crops (`docs/reference/figma-exports/screens/crops.json`) contain other content, so a pixel score would mean nothing. Tooltip has no Figma reference; it follows Graphite.
- **Screen exports** are kept once per screen (full 1440 × 900 frames at 2x); the crop areas are recorded in `crops.json`.
- **Baselines are per platform** (`-linux` in the file name). CI needs baselines generated on its own OS: upgrade-later item 16.

## 28 Oct 2026: menu details, version page, catalogue hosting (phase 1a, step 11)

- **Menu rows follow Figma screen 27** (owner asked for the icons):
  - a 14 px icon (new token `size.icon.xs`)
  - the description on the label's line, optionally in the code font
  - the shortcut in an outlined keycap
  - Figma's eight-ray "spark" icon is approximated by Lucide `Sparkle`.
- **Single-choice menus** (`selectionMode="single"`) show a tick on the chosen item, as in Figma's agent picker (screen 30). React Aria exposes the items as `menuitemradio` with `aria-checked`.
- **Version page:** product name, a one-line honest status, the build line, a link to the catalogue and a theme menu (System / Dark / Light, remembered in local storage).
  - Links are underlined primary text, not accent-coloured: Graphite keeps the accent for selection and focus.
  - Bundle: 121 kB gzipped (was 69 kB), because the page now uses React Aria's menu, popover and focus management. This is within the cost ADR 0008 measured.
- **Catalogue on its own Worker and origin** (ADR 0010), because Storybook needs inline scripts and styles.
- **Storybook's Accessibility tab** no longer runs three page-level best-practice rules (`region`, `landmark-one-main`, `page-has-heading-one`). A single component has no page around it; the WCAG rules still run, there and in `pnpm test:visual`.

## 28 Oct 2026: closing phase 1a

- **Product version 0.2.0** (root `package.json`). Each phase that adds features bumps the minor version; the smoke test reads the version from `package.json` instead of hard-coding it.
- **The web build now has the root `package.json` as a Turbo input** (`$TURBO_ROOT$/package.json`). Without it, the version bump reused the cached 0.1.0 build; the smoke test caught it.

## 28–29 Oct 2026: Signal palette for change states and the accent (owner decision)

**Owner decision:** the muted state and accent hues looked AI-generated. All five shared one lightness and softness, evenly spaced around the colour wheel as pastel tints. After reviewing six alternatives on real nodes (review page with contrast and colour-blind checks), the owner chose **Signal**: clearer signals, each hue tuned to its own strength, on the unchanged quiet greys.

**Dark values** (solid / tint / text):

| State | Values |
| --- | --- |
| added (green) | #3F9C6B / #1D2C2A / #65B186 |
| modified (amber) | #DDB04A / #322E25 / #EFCC83 |
| removed (coral red) | #E4655C / #332528 / #E39289 |
| affected (violet) | #9579E6 / #28273A / #AA9CE1 |
| outside selection (pink) | #DE7FBA / #322834 / #ECA4CF |
| accent (signal blue) | #4C8DEB, with hover #5B9DFC, tint #1F2A3A, ring #2A4367, text #80A9E6 |

**Light values:** derived from the same hues.
- State solids are at least 3.6:1 on white, and tag text is at least 5:1 on its tint.
- The accent is #3374D0.
- Contrast is enforced by the `packages/tokens` tests.

**Measured gains over the muted set:**
- The closest pair of state colours is 12.5 apart (muted: 5.0).
- Under deuteranopia it is 6.8 (muted: 2.9); under protanopia 6.9 (muted: 3.9).
- The accent is 9.6 from the nearest state (muted: 3.5, lavender next to steel blue).

Signal is close to, but softer than, the original saturated palette replaced on 26 Oct.

**Where the change landed:**
- tokens (both themes)
- the Graphite colour section, light table, accessibility ratios and history
- `CLAUDE.md` colour list and source priority (the tokens now win on colour values)
- the design-brief note
- the generator scripts' `HEX` maps
- the visual report colours

**Engineering finding:** the catalogue regression test used Playwright's default per-pixel colour tolerance (0.2), and **all 62 screenshots passed after the palette changed**. Now `threshold: 0`: 32 coloured stories failed as they should, and after approving the new baselines two reruns were identical. Same machine and browser, so exact pixels are stable.

**Figma:** the file's fills are bound to Figma Variables, so the owner updates 20 colour variables (accent ×5, states ×15) and re-exports the 20 component PNGs. Until then, the Figma comparison test fails on colour (Tag up to 8.3%, Flow node Selected 10.1%, against budgets of 6–7%).

**Update 29 Oct 2026:** the owner decided not to update Figma or re-export now (only colours changed). The four affected Figma-comparison budgets were raised, with the reason in the test file, and restoring them is upgrade-later item 19.

## 29 Oct 2026: phase 1b scope (owner decisions)

1. **No automated comparison with Figma.**
   - Figma and the prototype screenshots (`docs/reference/screens/`) are the visual *reference*: Claude builds from them with our own components, and the owner reviews the result by eye.
   - What stays automated: visual regression against **our own approved baselines** (every catalogue story and, later, every screen, both themes, pixel-exact) plus axe accessibility checks.
   - The phase 1a Figma comparison test (`e2e/visual/figma.spec.ts`) is retired in phase 1b, step 1. The exported PNGs stay in `docs/reference/figma-exports/` as reference images.
   - The build plan's "screenshot comparison against Figma exports" (phase 1b, and "Figma comparison" in "See it and test it") is amended accordingly.
   - Also amended: tokens are owned by code (`packages/tokens/source`); Figma is not their source.
2. **A larger, deliberately varied test corpus from now on.** Two similar Next.js apps can't show that analysis generalises.
   - The stage-1 corpus becomes **six** repos chosen to differ in framework, size, data layer, background work, real-time behaviour, AI/external services and repo shape.
   - Each is a public open-source project, kept as a private copy pinned to an exact commit (decision A8). Stack and licence are verified when pinning, and recorded in `corpus/manifest.json`.

   | Repo | Why it's in the set |
   | --- | --- |
   | Rallly | Scheduling polls. Small Next.js app with tRPC and Prisma: the simple baseline |
   | Documenso | Document signing. File uploads, PDF processing and email; medium |
   | Inbox Zero | Email assistant. AI model calls, OAuth, external APIs and background processing |
   | Twenty | CRM. Large monorepo with a NestJS + GraphQL backend, a React front end and job queues |
   | Excalidraw | Whiteboard. Client-only React app on Vite, canvas rendering and real-time collaboration, no server database |
   | Medusa | Commerce platform. Large Node.js backend framework (modules, workflows, events) with an admin dashboard |

   The build plan's later additions (Dub, PhET, and the waves in stages 7–8) still come on top.
3. **CI stays on GitHub Actions.** The owner will clear the billing lock later; no alternative CI. Until then, workflows are written and verified locally (with `act`, which runs Actions workflows in Docker), and phase 1b's Done-when can't be proven on GitHub. So 1b stays *in review* until Actions run.
4. **"Open demo project" button moves to phase 1d** (when cloud workspaces exist). Phase 1b sets up the pinned corpus and its manifest.
5. **Test reports and recordings are published to a third free Cloudflare Worker** (`flowcanvas-reports`), one page per run, linked from the PR.
6. **What's new and Labs are built from the existing components** (no Figma design for them). They move into the app shell in phase 2.

## 29 Oct 2026: the test corpus (phase 1b, step 7)

1. **Public forks** (owner decision, replacing A8's "private forks").
   - The corpus repos are public forks in the owner's GitHub account.
   - Allowed: AGPL and MIT both permit public redistribution with the licence and notices intact, which a GitHub fork keeps.
   - Simpler: GitHub copies a fork on its side in seconds, and CI reads them without tokens.
   - Rules that still apply:
     - their code never enters this repository; tests read or clone the forks
     - their **commercial or enterprise parts are never enabled**: Documenso `packages/ee`, Twenty's `@license Enterprise` files, Medusa's Enterprise Edition
     - anything pushed to the forks is public, which is fine for test data
2. **LibreChat replaces Inbox Zero** (owner decision, recommended option).
   - Inbox Zero's licence adds terms to AGPL-3.0: no commercial use "that involves monetizing the software", and a paid licence for organisations of 5+ users using it for business. Running it as a demo project inside a commercial product is too close to that.
   - LibreChat (MIT) brings the same variety (AI providers, OAuth sign-in, external APIs) plus an Express backend and MongoDB.
   - This amends the build plan's stage-1 fork list.
3. **Pin rule:** each repo's default branch as it was at 2026-10-15T00:00:00Z, two weeks before pinning. Release tags didn't work as a rule: some sit on release branches that aren't in the default-branch-only forks, and LibreChat had no stable release in the window.
4. **Stack verified at the pinned commit** from each repo's own `package.json` files, not assumed:

   | Repo | Stack |
   | --- | --- |
   | Rallly | Next.js, tRPC, Prisma, Better Auth |
   | Documenso | React Router (Remix), Hono, Prisma, BullMQ and Inngest |
   | LibreChat | Express, Mongoose, OpenAI, Passport; React on Vite |
   | Twenty | NestJS, TypeORM, GraphQL, BullMQ; React |
   | Excalidraw | Vite, React |
   | Medusa | Express, MikroORM; React admin |

   The evidence files and each licence's SHA-256 are in `corpus/manifest.json`, and `pnpm corpus:check` re-verifies them, also in CI.
5. **Reports protection deadline relaxed.** Upgrade-later 11 had required protecting the reports site before phase 1d because recordings would show private copies. With public forks it reverts to the general trigger: before reports show real user or project data, or are shared outside the team.

## 30 Oct 2026: phase 1c decisions (owner)

1. **The control plane runs inside the existing app Worker, under `/api`, with a free Neon Postgres database** (option A; no payment method needed).
   - The service moves from Fastify to a Workers-compatible framework (Hono, same TypeScript).
   - The API shares the app's origin, so session cookies are first-party and the app's CSP (`connect-src 'self'`) needs no change.
   - Verified first by a spike (step 1, ADR). Fly.io stays in upgrade-later 12 for when a separate service is needed.
2. **Sign-in is limited to an allowlist** while in private development, starting with the owner, who is the admin.
3. **Sign-in works on staging and local development only.** GitHub and Google only redirect to pre-registered addresses, and preview addresses change per branch. Previews show a "sign in on staging" notice.


## 31 Oct 2026: repository moved to another account (owner decision)

GitHub Actions never ran on `ArmaanAhuja-7777` because of the account billing lock (upgrade-later 8). Instead of clearing the lock, the owner **transferred the repository to their other account, `ArmaanAhuja`**, where Actions runs normally.

1. **New home: https://github.com/ArmaanAhuja/Flowcanvas.** Renamed from `Glassbox` in the same transfer: "Glassbox" has a trademark conflict and shouldn't sit in a public URL. `Flowcanvas` is still a working name; the repository is renamed again when the product name is chosen.
2. **What moved with it:** history, PRs #1–#6, the Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the variable `CLOUDFLARE_WORKERS_SUBDOMAIN` (all checked after the transfer). Old URLs redirect, but links in the docs now point to the new address.
3. **`ArmaanAhuja-7777` stays a collaborator** (write access, added by the transfer), so commits and PRs can still come from it. Repository settings (secrets, branch protection) need the owner account.
4. **Cloudflare Workers Builds reconnected** to the moved repository for both `flowcanvas` and `flowcanvas-catalogue`, with the same build commands and variables as before (phase 1 step 11, phase 1a); the Cloudflare GitHub app now has access to this repository only.
5. **What stays on `ArmaanAhuja-7777`:** the six corpus forks (separate repositories that `corpus:check` only reads) and the GitHub OAuth apps for sign-in (they don't depend on where the code lives). **Update (same day):** the owner transferred both GitHub OAuth apps (staging and local) to `ArmaanAhuja` as well, ahead of a notice that the old account may be restricted from 26 Nov 2026; their client IDs and secrets didn't change.
6. **Acceptance:** once a PR run and the following `main` run pass on GitHub, the upgrade-later item 8 steps are done, and phases 1 and 1b move to *accepted*. From then on the "PR #1 exception" ends: merge only when CI is green.
7. **Result (same day):** PR #7 ran every job on GitHub and passed, and so did its merge to `main` (`157b55f`), which tested staging and moved the reports' main address. Phases 1 and 1b are **accepted**, as the owner had agreed. The PR #1 exception has ended.
8. **`main` is protected by a ruleset (same day, owner).** Pull request required (0 approvals while the owner works alone), the three test jobs must pass on a branch that is up to date with `main`, no bypass, deletions and force pushes blocked. `Publish report and comment` is deliberately not required: it runs even when tests fail, and a reports outage shouldn't block merges. This replaces the "merge only when green" honour rule with enforcement and closes upgrade-later items 1 and 5.

## 1 Nov 2026: phase 1c on staging; local development used production

1. **Local development pointed at the production database.** `.dev.vars`'s `DATABASE_URL` had been the Neon `production` branch's string since step 1c.1, not `dev`'s (setup table in build-steps 1c.0). Found when migrating staging printed the same host as local runs. Consequences:
   - The migrations and every "checked against Neon" script in phase 1c ran on production; the docs now say so.
   - Local test data was in staging's database.
2. **Clean-up (owner approved, 2 Nov 2026):** the local test project `Rallyy` was deleted from production, with its workspace record and data key. It had no secrets, and its key was wrapped by the local vault key, so staging couldn't have used it. Kept: the owner's two user rows and allowlist entries, and the staging project `Staging test`.
3. **Fix:** the owner puts the `dev` branch's string in `.dev.vars`; then `pnpm db:migrate` and `pnpm db:allow` run against `dev`. The local and staging vault keys already differ.
4. **Cloudflare's invocation logs are off** (`observability.logs.invocation_logs: false`). The staging check showed they record each request's full URL, including the sign-in callback's OAuth `code`. Cloudflare redacted `state` and IDs, not the code. Our own log lines (already redacted) are still kept in Workers Logs.
5. **Done (2 Nov 2026):** `.dev.vars` now points at the `dev` branch (`ep-square-leaf…`), migrated with 0001 and 0002, owner allowed as admin. Local and staging no longer share a database.
6. **Phase 1c accepted by the owner (2 Nov 2026).** The staging GitHub client secret wasn't rotated: the owner kept the stored one (upgrade-later 32).

## 4 Nov 2026: phase 1d sandbox provider (owner decision)

*Items 1 and 2 were superseded the same day by the next entry: E2B needed a payment, so workspaces run in local Docker containers for now.*

1. **E2B is the managed sandbox provider** for cloud workspaces. Compared: E2B, Modal, Daytona and Vercel Sandbox (phase 1d overview). E2B is the only free option that fits all three Done-when items as written: Firecracker microVMs (isolation), pause and resume that keep memory and disk ("resumes intact"), and egress allow and deny lists. Alternatives and why not:
   - Modal: gVisor, and its snapshots restore disk only
   - Daytona: containers, and custom network rules only at a $500 tier
   - Vercel Sandbox: Hobby is non-commercial use only, with 45-minute sessions
2. **Free first:** E2B Hobby's one-time $100 credit, with no payment method. Paid options and the trigger are in upgrade-later 33.
3. **Contained:** everything goes through our own `WorkspaceProvider` interface, so a later switch (to another provider or our own fleet) doesn't touch the rest.
4. **Risks R1–R7** of the phase plan (build-steps, phase 1d) are tracked at every step and closed in the phase report. The owner asked for them to be confirmed and kept in check.

## 4 Nov 2026: local Docker workspaces for now; phase 1d closes "in review" (owner decision)

1. **E2B needs a payment.** Its pricing page says "No credit card required to start", and the account showed the Hobby plan. But creating an API key asked for a $5 payment. Under the free-first rule, the owner chose not to pay for now.
2. **Workspaces run in local Docker containers for now** (option C of three; the others were paying the $5, or switching to another provider that's free without a card). A small local workspace host (`workspace/host`, 127.0.0.1 only, token-protected) is the only thing that talks to Docker. It sits behind the same `WorkspaceProvider` interface a cloud provider will use. The cloud provider is chosen and connected later (upgrade-later 33).
3. **What this costs:**
   - Containers share the host's kernel, so they isolate less than the VMs the build plan asks for (risk R1, upgrade-later 34).
   - Staging can't reach a laptop, so workspaces work locally only. Staging says "Workspaces run locally for now".
4. **Phase 1d closes as "in review", not "accepted",** and phase 2 goes ahead. This is the owner's exception to the one-phase-at-a-time rule (CLAUDE.md rule 1). The *Done when* items are proven locally and in CI with Docker. Phase 1d is accepted once a cloud provider is connected and the same checks pass on staging.
5. **Risks:** R1–R7 were rewritten for Docker, and R8 (the phase can't be fully accepted yet) was added (build-steps, phase 1d).

## 4 Nov 2026: the laptop's footprint and resource guard (owner request)

1. **Everything local workspaces put on the owner's laptop is labelled and listed** (build-steps, phase 1d, "On the owner's laptop"). It's all removed when the cloud provider is connected: `pnpm workspace:clean --all`, then the `.dev.vars` line and the local-only code (upgrade-later 33).
2. **A resource guard keeps Flowcanvas within a budget on the laptop** (step 8a). Claude chose the thresholds from the laptop's figures (16 cores, 30.8 GiB, 950 GiB):
   - 2 workspaces at once
   - 25 GiB of disk for Flowcanvas
   - pressure when available memory is under 4 GiB, free disk under 50 GiB, or the load over 14 for 2 minutes

   Under pressure it refuses new starts, then puts idle workspaces to sleep, then stops the least recently used ones (files kept), then removes unneeded Flowcanvas images, containers and orphaned volumes. It never touches anything that isn't Flowcanvas's.
3. **Claude checks the laptop's resources at every step** and reports them in the step's Risks line (risk R9).

## 4 Nov 2026: sign-in refused locally after the move to the dev database

1. **What happened.** Signing in on `localhost:5173` said the account wasn't on the allowlist. The dev database's allowlist had one entry (the owner, as admin), and no account had ever signed in there. GitHub sign-in checks the GitHub account's **primary verified email**. The browser was signed in to a GitHub account whose primary email is a different one of the owner's addresses. On production both of the owner's addresses were allowed; when local development moved to the `dev` branch (2 Nov), only one was added.
2. **Fix for the owner:** allow the other address on the dev database with `pnpm db:allow <email> --admin` (it prints the database host, which should be the `dev` branch's). Or sign in with Google, or with the GitHub account whose primary email is the allowed one.
3. **So it can't be a mystery again:** the refusal now says which account was checked, masked (for example `It was checked as ma…@example.com.`). The API adds `as=<masked>` to the redirect, never the whole address; the page shows it only if it matches the masked pattern.

## 7 Nov 2026: phase 1d after the merge; phase 2 plan (owner decisions)

**Phase 1d:** the owner confirmed on staging that projects are listed, that the page says "Workspaces run locally for now", and that What's new shows 0.5.0. With the owner's migration of staging's database (0003, 0004, 6 Nov), the after-merge checks are done. The phase stays **in review** until a cloud provider is connected.

**Phase 2 (canvas and app shell), the owner's answers to the plan's questions:**
1. **"Placeholder content" against rule 10.** The shell shows honest empty states, such as "Flows appear here once the project is analysed". The 500 dummy nodes appear only in the component catalogue, the performance test, and a Labs switch labelled as a preview. Real content goes wherever it already exists: the project, the workspace chip, the terminal.
2. **"Dock" panels.** Panels are docked to their edges and collapse and resize. Moving panels between sides isn't in the build plan or the design brief, so it's recorded in upgrade-later (40).
3. **The projects list stays at `/` for now.** **Open** goes to the project's page (`/p/<id>`). The start screen comes with its own phase.

**Also settled for phase 2, from the sources:**
- **Sizes follow Figma** (top bar 40, rail 44, left panel 248, right panel 360, review bar 40 and 300 open) where the design brief differs (44, 48, 260, 280).
- **The terminal goes in a bottom dock** above the review bar (design brief, "18. Terminal and run manager").

## 7 Nov 2026: running on your own computer from the hosted site waits for phase 48a (owner decision)

**Asked:** that people can choose between running their projects on our hosting or on their own laptop, and how the hosted site would reach a laptop, including the app's running screens.

**Decided:**
- It's phase **48a, the local runner**, as the build plan has it. It's not pulled forward.
- **Requirement for 48a: the choice must be seamless.** The same hosted site, and per project, "our cloud workspace" or "my computer".
- Phase 2 continues meanwhile. Until 48a, workspaces run on a laptop only through `pnpm dev`.

**The approach, recorded for 48a** (the owner's answer to the plan's question):
- **The laptop dials out; nothing dials in.** The runner (the workspace host in a runner mode) keeps an outgoing encrypted WebSocket to a Cloudflare Durable Object per connected computer, which is on the free plan.
- **The web app's requests travel down that connection.** So the laptop opens no ports, its services stay on 127.0.0.1, and the browser only ever talks to our site.
- **Pairing:** a one-time code from "Connect this computer" on the site. The server stores the runner's token only as a hash, and computers can be listed and revoked.
- **The tunnel is only transport:** a "runner" workspace provider sends the same fixed, checked host operations.
- **The app's running screens** (live frames, stage 2) use the same tunnel, served from a separate preview origin with links signed per user and session.
- **Rejected:**
  - the browser calling `localhost`: browsers block it or ask, and the page would hold the host's token
  - a public tunnel per laptop: it exposes the laptop to the internet

**Also decided:** a living run-and-features doc, `docs/RUN-AND-FEATURES.md`, linked from a new `README.md` and updated at every build step.


## 7 Nov 2026: phase 2's close zoom is accepted as a known issue (owner decision)

**Asked:** the 500-node test meets "smooth" everywhere except zooming in close (100% to 200%), where nodes enter and leave the page and the 95th-percentile frame is about 33 ms (target under 25 ms). Fix it now, or accept it?

**Decided:** accepted as a **known issue** in the phase 2 report. The build plan's **phase 42** (the WebGL renderer with level of detail) is what fixes it. It's not an upgrade-later entry, because it's already planned. The performance test keeps its own, named limit for that one scene (`CLOSE_ZOOM_LIMITS`), so it can't get worse unnoticed.

## 7 Nov 2026: the review bar stays at the bottom (owner decision)

**Asked:** Figma 06, alone among the screens, has the review bar at the top (under the top bar). Every other screen, the generator script and the design brief have it at the bottom.

**Decided:** **at the bottom**, as built. Figma 06's position is treated as a one-off; when the Figma file is next regenerated from the script, it will match.

## 7 Nov 2026: phase 2 accepted; phase 3 plan (owner decisions)

**Phase 2:** accepted by the owner and merged (PR #15, `14d1c2e`).

**Phase 3 answers:**
1. **Autosave is for when a person forgets to save** (owner): an amalgamation of a save button and real autosave.
   - **Ctrl/⌘+S** writes the file at once.
   - **Autosave** writes it after **5 seconds without typing**, and at once when you switch to another file, leave the Code view, or the browser window loses focus.
   - **The journal underneath:** unsaved changes go to the workspace every 2 seconds while typing and when the tab is hidden or closed (plus a copy in the browser's IndexedDB), so nothing is lost before an autosave or when the workspace can't be reached. Reopening restores them.
   - **A switch** in the status bar, "Autosave: on/off", kept per browser; on by default.
2. **The editor lives in the Code view** (Figma 11) in this phase. The editor as a card on the canvas (design brief §17) comes with phase 7.
3. **No fake errors:** syntax highlighting only. The editor's own type checking (Monaco's, when this was written; see the next entry for CodeMirror 6) stays off, because without the project's types it would report wrong errors, and the status bar shows no error count until phase 33's language servers.

## 7 Nov 2026: the code editor is CodeMirror 6, not Monaco (owner decision)

**Found (phase 3 step 1 spike):** Monaco draws every line with inline `style` attributes, which our Content-Security-Policy forbids, so it would only work if the policy allowed `style-src-attr 'unsafe-inline'`.

**Owner:** the editor doesn't have to be, or look like, VS Code; explore and pick what suits Flowcanvas best.

**Compared** (each under our production policy, with the same tests): Monaco, CodeMirror 6 and Ace. The figures are in ADR 0021.

**Decided:** **CodeMirror 6**, each editor in its own shadow root.
- It runs under the unchanged strict policy.
- It's about a fifth of Monaco's download (147 against 705 kB gzipped) and a third of its memory per editor, which matters for code cards on the canvas (phase 7).
- It typed fastest in a 20,000-line file.
- It takes colours straight from our CSS variables.
- It has official packages for the diffs with accept and reject per change (stage 3), language servers (phase 33) and shared editing (phase 77).

The build plan's technology table and phase 3, and CLAUDE.md's stack line, now say CodeMirror 6, pointing to ADR 0021. The owner asked for the replacement to be complete: Monaco and Ace are removed from the dependencies, and every document that named Monaco as our choice is updated or carries a dated note.

## 8 Nov 2026: a faster working pace, the code palette, and the project page's budget (owner decisions)

**Working pace** (CLAUDE.md section 4a, "Working pace"): faster, with every test type, document, decision record and Done-when proof kept.
1. **Milestones of 2–3 steps,** reported once. The phase plan's "go" and the end-of-phase acceptance stay, and anything risky still stops at once.
2. **Tiered testing:** tests for what changed while working; every suite once before a milestone's commits are pushed; CI again on the pull request; heavy suites in the background, one at a time.
3. **Docs once per milestone, complete** (owner: "make it thorough… don't forget anything"): a fixed template for each step, checked step by step before reporting.
4. **Questions up front; and whenever something unforeseen comes up mid-phase, ask, never decide** (owner). When the documents and decisions already settle a question (the source priority, Graphite, this log), apply them and report.
5. **Careful edits:** exact lines read from a file, formatting before editing, every edit checked.

**The code palette:** quiet. Keywords and strings in `text/secondary` (keywords semibold), comments in `text/muted`, everything else `text/primary`. Green, amber, red, violet and pink keep meaning change state, and blue keeps meaning selection and focus.
- **Why it was asked:** no document defined colours for code, and Figma 11 used the state hues and the accent for it.
- **Why it needn't have been:** Graphite outranks Figma, and its rules ("colour only carries meaning"; blue for selection and focus only) already pointed here. Rule 4 above now covers this case.

**The project page's bundle budget:** 95 → 110 kB, chosen by Claude at the owner's request ("whatever is the best decision"). Phase 3's journal and autosave (93.1 kB now) must run whenever a project is open, the Graph view included, to keep unsaved work safe; loading them lazily would only delay that. The reason is in `apps/web/scripts/bundle-size.ts`.

## 8 Nov 2026: a file deleted in the workspace while it's open (owner decision)

**Asked** (at the start of the step 7 and 8 milestone, the one case the plan didn't cover): what happens when an open file is deleted in the workspace (`rm` in the terminal, another tab, later an agent)?

**Decided:**
- **Without unsaved changes:** the tab stays and says "This file was deleted in the workspace," with **Close**.
- **With unsaved changes:** "This file was deleted in the workspace. Your changes are still here, not saved," with **Save it again** (which recreates the file) or **Close…**, which asks first ("Discard your changes and close the file?" with **Discard** or **Cancel**). Nothing is lost by one click.
- **Autosave never recreates a deleted file by itself.**

## 8 Nov 2026: phase 3 accepted; Node 26

**Phase 3:** accepted by the owner and merged (PR #16, `aa6364a`). Staging serves 0.7.0.

**Node 26 LTS** (upgrade-later 2, due at the phase 3 review): the repository moves from Node 24 to 26 in its own pull request (`.nvmrc`, `engines`, `@types/node`, the workspace image's base by digest). The new workspace image is used by workspaces created from now on; existing ones keep theirs until they're recreated (the agent works on both).

**A correction on release age** (CLAUDE.md working-pace rule 4: settled by the docs, so applied and reported): ADR 0006's rule is pnpm's minimum release age, which isn't set in this repository, so pnpm 12's default of **one day** applies ("brand-new releases wait about a day"). Claude had been applying two weeks out of habit, which is stricter and harmless, but not the project's rule. The `node:26-slim` base image (built 5 Nov 2026) meets the one-day rule and is pinned by digest.

**Cloudflare's builds failed at first** (`ERR_PNPM_UNSUPPORTED_ENGINE`): Cloudflare installs Node from its own build variable `NODE_VERSION`, still `24`, not from `.nvmrc`. The owner sets it to `26.13.0` in both Cloudflare projects (ADR 0004 addendum), which are account settings.

**Also found on the way:** a timing-dependent unit test, where the first test of a file waited at most 1 s for CodeMirror's first load. It now allows 10 s, and jsdom gets empty Range geometry so CodeMirror's measuring stops logging errors. Three full parallel runs are clean.

## 9 Nov 2026: phase 4 plan (owner decisions); Node 26 merged

**Node 26** is merged (PR #17, `4829ac5`), with both Cloudflare projects' `NODE_VERSION` set to 26.13.0 by the owner. All checks passed, both Cloudflare builds included.

**Phase 4, the indexer:**
1. **"A tree-sitter parse of every file"** means every file of a language we ship a grammar for: TypeScript, TSX, JavaScript, JSX, CSS, JSON, HTML and Markdown (owner, Claude's recommendation). Other files are still listed and counted, and the page says honestly how many weren't parsed and why.
2. **Go** for milestone A.

**Settled by the documents** (applied, CLAUDE.md working-pace rule 4):
- "Both forks" means **Rallly and Documenso**, stage 0's test repos (build plan, stage 0). All six are measured and reported.
- **⌘K (Ctrl+K) is the command palette** (design brief §22, Figma 16). In this phase it has Symbols and Files groups. Ctrl/⌘+P stays files only (phase 3).
- **A symbol opens in the Code view at its line;** the canvas shows code once flows exist (phase 7).
- **Indexing is not activity:** it never keeps a workspace awake.
- **"Under 100 ms" is measured both ways,** the engine's query (p95) and the browser's keypress to results; both must pass.

**Phase 4, milestone A** (asked during step 1):
3. **Markdown: we build the grammar ourselves** (owner). No published package ships it as WebAssembly. `tools/grammars/build-markdown.sh` builds it reproducibly from the grammar's own C source, with every input pinned and checked by SHA-256. It compiles in a container with no network, and the outputs' checksums are committed (ADR 0023).
4. **MDX is parsed as Markdown** (owner, Claude's recommendation). There are 188 `.mdx` files in the two forks (45 in Rallly, 143 in Documenso), and no maintained MDX grammar. Headings and text are read; embedded JSX components aren't. The engine marks each one as partly read (`mdx-components`), and the page says so.
5. **Symbols in languages other than TS and JS: Markdown headings only** (owner). CSS, HTML and JSON are parsed and counted, but list no symbols in ⌘K (Claude had also recommended CSS names; the owner chose headings only). TS and JS symbols follow the plan: functions, components, classes, methods, interfaces, types, enums and module-level constants (ADR 0024).

**Settled by the documents** (applied):
- **Secret files are never indexed** by the agent's rule (CLAUDE.md rule 5). Rallly's `apps/web/.env.test` is one of them.
- `.mts`/`.cts` are TypeScript and `.mjs`/`.cjs` JavaScript (the same languages), `.htm` is HTML, and extensions match without regard to case (`README.MD`).

## 11 Nov 2026: phase 4, milestone B (settled by the documents, applied)

- **The engine runs inside the workspace** (CLAUDE.md §7), as its own process copied in by the host, and follows changes with its own watcher, so re-indexing works whether or not a page is open (ADR 0025).
- **Index status never counts as activity; a search does,** like opening a file (decisions log, 9 Nov 2026: indexing is not activity).
- **The palette lists Symbols first, then Files, and highlights the first result,** because the approved try-it is "⌘K, a function's name, Enter, the Code view at that line".
- **`#` searches files only** (design brief §22). The other prefixes (`>` commands, `@` nodes, `/` routes) arrive with their groups.
- **The top bar's search opens the palette** (Figma 06 shows it with ⌘K; brief §22).

## 11 Nov 2026: a faster pace, with nothing dropped (owner)

Claude proposed six ways to go faster after milestone B; the owner decided (CLAUDE.md §4a "Working pace"):
1. **Accepted: heavy suites on CI.** The laptop runs the fast suites before a push (format, lint, typecheck, all unit tests). Walkthroughs, visual and Docker run on CI, on a draft pull request opened at the phase's first push. A milestone is reported only when CI is green on its last commit; `main` still needs every required check.
2. **Not accepted:** Turborepo's `--affected` filter while working.
3. **Not accepted:** shorter docs. They stay as complete as before.
4. **Accepted:** the test projects (corpus forks) cached outside `/tmp`, so a restart doesn't lose them.
5. **Not accepted:** a fixed rerun limit for flaky tests. Every flaky test is investigated until it's explained, or recorded with what was checked.
6. **Accepted:** milestones of 3–4 steps instead of 2–3.

## 11–12 Nov 2026: phase 4 accepted; a pixel tolerance for anti-aliasing; phase 5 plan (owner decisions)

**Phase 4:** accepted by the owner on 11 Nov ("do as you seem okay and continue") and merged (PR #18, `88a3a78`).

**Visual tests allow up to 4 differing pixels** (owner, 12 Nov, Claude's recommendation). This is a small, written deviation from "pixel-exact" (CLAUDE.md §8).
- **What happened:** `main`'s first CI run after the merge failed the file tree's "large" story by 1 pixel. Milestone A's flow-node failure (9 Nov) was the same thing.
- **The cause:** under CPU load, Chromium draws 1–2 pixels of an icon's anti-aliased edge 1–3 colour levels differently. It happened in 6 of 240 runs with 8 parallel browsers, and none of 120 at normal load.
- **What didn't fix it:** Chromium's switches for partial and low-resolution drawing. One changes rendering outright.
- **The rule now:** `maxDiffPixels: 4` on every screenshot. Any real change is hundreds of pixels; `threshold: 0` still counts every colour change in those pixels.

**Phase 5, TypeScript semantics:**
1. **Callers and callees appear in the right panel's Calls tab** (Figma's inspector; the brief calls it "Connections"), for the function at the cursor in the Code view. The same panel serves canvas nodes from phase 6.
2. **Project code only, honestly** (owner). A cloned workspace has no `node_modules` unless the person installs them.
   - Calls within the project are resolved.
   - Calls into packages show as unresolved ("install dependencies to resolve"), never guessed.
   - Nothing installs by itself. An automatic install can come with the dev-server phase.
3. **Rendering counts as a call, marked "renders"** (owner). A component's callers include the components that render it (`<PollForm />`), and its callees the components it renders.
4. **Claude picks and labels the 20 functions** for the Done-when check: 10 in Rallly and 10 in Documenso, covering plain functions, methods, components, re-exports and path aliases. Their callers and callees are labelled by reading the code (`corpus/labels/calls.json`), for the owner to spot-check.

**Settled by the documents** (applied):
- **TypeScript 6's compiler API.** Upgrade-later 3 was checked as it asks: TS 7's API is still unstable, and typescript-eslint supports `<6.1`.
- **Every caller and callee row carries how it's known** (CLAUDE.md rule 4): *resolved* when the compiler proved it, *unresolved* when it couldn't (such as `obj[key]()`, or a package without types).
- **The Try it says "right-click a function → Callers",** so the Code view gets a context menu: Callers, Callees, Go to definition and Find references. F12 and Shift+F12 are the usual keys for the last two.

**Phase 5, milestone B** (owner, 12 Nov 2026):
5. **Built-ins** (`Math.max`, `Promise.all`) in a function's callees: listed after the project's calls, in a collapsed "Built-in" group. Unresolved calls get their own group, labelled as unresolved.
6. **A caller outside any named function** (a module's top level, or an anonymous callback there, such as an API route handler) is named by its file: `route.ts (top level)`, with its line.
7. **Find references** shows in the same right-panel Calls tab as a third view: Callers, Callees, References.

**Settled by the documents** (applied):
- **Provenance in the rows** follows Graphite's form channel: *resolved* is a plain solid line with no glyph; *unresolved* (Graphite's "unknown") is a short open stub ending in a hollow circle. Each row also says the word, so meaning is never carried by form alone.

**Phase 5, step 6: what the corpus check settled** (applied by Claude, 12 Nov 2026, by CLAUDE.md rule 4 and owner decision 2 "never guessed"; ADR 0026, addendum):
- **A call TypeScript's call hierarchy leaves out, but whose name the compiler finds,** is listed by what that name is. A built-in (`Boolean`, `new Error`, `fetch`), a module-level constant (`export const nanoid = customAlphabet(…)`) or an interface or class member is fixed where it's declared: *resolved*. A parameter, a local, a destructured name or an object literal's property holds whatever it's given at run time: *unresolved*, with the call's text (`getValue`, `resolve`).
- **An IIFE** (`(() => …)()`) isn't a call of anything unknown: its body is the function's own code, and its calls are listed as the function's.
- **A caller in `packages/ee`** (Documenso's commercial code) is listed like any other: it is one, and the engine reads the project as it is. The labels name it from its import and declaration lines only; nothing there is run or enabled (CLAUDE.md rule 8).

**Phase 5 accepted** (owner, 12 Nov 2026): "accepted and now let's move ahead". Merged in PR #19 once CI is green on its last commit.

## 12 Nov 2026: phase 6, the graph model

**Owner decisions:**
1. **Forks held to the Done when:** the plan's four, with LibreChat in Inbox Zero's place (29 Oct): Rallly, Documenso, LibreChat and Twenty. Excalidraw and Medusa are measured and reported, as in phase 4.
2. **Kinds not detected yet** (entry points, data access, external boundaries, async hand-offs, decisions) are listed in Graph stats with 0 and the phase they arrive in.
3. **Built-ins stay out of the graph** (they stay in the Calls tab); Graph stats counts them separately.
4. **Graph stats** (behind its Labs switch) shows in the inspector's Details tab when nothing is selected.

**Settled by the documents** (applied):
- **Edge provenance** uses CLAUDE.md's five: observed, resolved, convention, suggested, unknown. Phase 5's *unresolved* is stored as *unknown*; the Calls tab keeps its wording.
- **Change state** uses the research report's five: added, removed, modified, possibly affected, unchanged; plus *analysing* for freshness (CLAUDE.md section 11).

**Owner decision** (12 Nov 2026, phase 6): **whatever the site shows that arrives in a later phase says so, naming the phase**: an empty panel, a disabled tab or button, a placeholder text, a zero count, a feature stub. Found when the entry points panel said "Entry points appear here once the project is analysed" although the project had been analysed; entry-point detection is phase 8. Applied now:
- Entry points: entry-point detection (phase 8). Flows on the canvas, and details of what's selected: the flow builder (phase 7).
- The Sequence view (phase 13). The inspector's Runs tab: dev-server tracing (phase 30); its Changes tab: the behavioural diff (phase 23).
- Agent sessions in the review bar: the agent panel (phase 19); the review of a session's changes: the review panel (phase 32).
- Workspaces on the owner's computer until a cloud provider is connected (phase 1d).
- Already so: Graph stats' zeros ("arrives in phase 8") and Labs ("Finished in phase 7").
- **Graph stats' Labs switch: "Finished in phase 7"** (Claude's choice, the flow builder draws the graph itself; owner, 12 Nov 2026: "you can have your choice").
- **The canvas stress test's switch: "Finished in phase 42"** (Claude, under the same delegation): it said phase 2, accepted on 7 Nov, though the switch stays; large canvases are finished by the performance phase's WebGL renderer ("2,000 nodes stay smooth"). Found by the new check below.
- **A test now holds every visible text to this** (`apps/web/src/later-phases.test.ts`, run with the web unit tests on every commit): no "later" without a phase, no "arrives" without one, and no phase named as still to come once STATUS.md marks it accepted; Labs' and Graph stats' phase numbers included. Asked for by the owner after a catalogue example kept showing the Code view as "arriving in a later phase" two phases after it shipped: the visual tests proved the example hadn't changed, not that it was still true.

**Owner decisions on the repository review** (12 Nov 2026, end of phase 6):
1. **`e2e/visual-report/`** (the retired Figma comparison's output, committed on 29 Oct) **stays**: it causes no problems.
2. **One shared fake workspace for walkthroughs and page tests** (12 files each build their own fake API): accepted, as long as it changes nothing the tests prove. Done alongside the next phase's work.
3. **The docs' overlap** (build-steps, reports, STATUS, RUN-AND-FEATURES) **stays as it is.**
4. **The hand-labelled checks stay as they are:** not reduced in size.

**Phase 6 accepted** (owner, 12 Nov 2026): "okay continue", after the report and a green CI. Merged in PR #20 once CI is green on its last commit.

## 12 Nov 2026: phase 7, the flow builder and inspector

**Owner decisions:**
1. **Opening a flow:** "Show flow" in the Code view's right-click menu, an action on functions in ⌘K, and a link on the Calls tab's function.
2. **Flow size:** breadth-first from the function, up to 60 nodes; beyond that, an honest "N more calls not shown" stub where the flow was cut. Expanding and collapsing arrive in phase 12.
3. **Unknown calls:** one grouped open-stub edge per node ("4 unknown calls"), each listed in the inspector. Per-call stubs and filters arrive in phase 12.
4. **The 10 flows of the Done when:** Claude picks 10 functions in Documenso and labels each flow by reading the code.

**Defaults stated in the plan, not changed by the owner:** one flow on the canvas at a time (opening another replaces it); a single click selects a node and fills the inspector; "Open code" (the inspector's button, or a double-click) opens the Code view at its line.

**Settled by the documents** (applied):
- **Layout:** left to right, with Figma 06's node anatomy (about 200 × 56 px: type icon, name, file and line). ELK (`elkjs`) runs in a Web Worker, off the page's main thread (CLAUDE.md section 7).
- **Decisions:** small diamonds with condition labels on their outgoing edges; failure paths (a `catch`) as thin red edges (design brief, "Flow graph view").
- **Built-ins** stay out of flows, as out of the graph (owner, 12 Nov 2026).
- **The completeness pill** at the flow's top left counts its edges by provenance (design brief).

## 13 Nov 2026: compute once, store, reuse

**Owner direction:** "we want to make the project feel faster and snappier for everything the user does, so we will rely on caching and storing data for further use so that we don't have to compute again and again." Asked to check where this is needed, plan it into the phases, handle anything already left, then continue with phase 7.

**Applied as a rule for every feature** (ADR 0029): what a person would wait for is worked out ahead (in the graph pass, in the background) and stored, keyed so it's never stale (a version, or the hash of the file it came from). Live work only for what changed since. Nothing stale is ever shown as current.

**Done now** (phase 7): each file's code units and the inspector's details are stored by the graph pass (`facts.db`); flows from inside a function and details answer from them. **Planned in phase 7, milestone B:** the Calls tab and Go to definition answered from stored data; the page keeps flows, details, calls and layouts per graph version. **Planned later:** see ADR 0029's table (references in phase 42; each later analysis stores its results in the graph as it's built).
