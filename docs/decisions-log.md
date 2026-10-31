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
