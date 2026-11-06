# Phase 1d — Workspace sandbox: report

- Version: `0.5.0`
- Branch: `phase/1d-workspace-sandbox`; PR: see `docs/STATUS.md`
- Dates: 4–6 Nov 2026
- Status: **in review**. The *Done when* items are proven on the owner's computer. The phase is accepted once a cloud sandbox provider is connected and the same checks pass on staging (owner decision, 4 Nov 2026; upgrade-later 33).

## From the build plan

- **Build:** one isolated virtual machine per project; clone a repo; file and process API; terminal in the browser; outbound network rules; resource limits; sleep when idle and resume.
- **Done when:** a fork clones and opens in under 60 s; a workspace sleeps after 10 idle minutes and resumes intact; workspaces can't reach each other.
- **Try it:** open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume.
- **Also here:** the "Open demo project" button, moved from 1b (decisions log, 29 Oct 2026).

**Owner decisions (decisions log, 4 Nov 2026):**
- **Local Docker containers for now.** E2B needed a $5 payment before it would issue an API key. A provider is chosen and connected later.
- **The phase closes "in review",** and phase 2 goes ahead.
- **A resource guard keeps Flowcanvas within a budget on the owner's laptop,** and everything local is removed when a provider is connected.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| One isolated workspace per project | ✅ locally (container, not VM) | ADR 0016. `workspace/image`: non-root, all capabilities dropped, `no-new-privileges`, read-only root, its own internal network, limits (2 CPUs, 4 GiB, 1,024 processes). Checked from inside a real container (`image.docker.test.ts`) |
| Clone a repo | ✅ | `host.docker.test.ts`. Rallly at its corpus pin `8e67a21`, shallow and detached (migration 0004) |
| File and process API | ✅ | `workspace/agent` (typed, versioned; never `.env`, never outside the project). Through the API: `file-routes.test.ts` |
| Terminal in the browser | ✅ | ADR 0017. A real pty through Docker's Engine API, relayed by the Worker (`local-host.docker.test.ts`, in workerd). xterm.js under the production CSP (walkthrough) |
| Outbound network rules | ✅ | An egress proxy to five allowlisted hosts, address-checked and limited (`proxy.test.ts`, 16 tests) |
| Resource limits | ✅ | Container limits (tested). The laptop's resource guard, ADR 0019 (`guard.test.ts`, the pressure Docker test) |
| Sleep when idle and resume | ✅ | ADR 0018: the minute check, and metering only while running |
| **Done when:** a fork clones and opens in under 60 s | ✅ locally · ⏳ provider | **7.0 s** at the pin (clone 5.6 s), and 9.8 s at the branch head. The test fails above 60 s |
| **Done when:** sleeps after 10 idle minutes and resumes intact | ✅ locally · ⏳ provider | With a moved clock (`local-host.docker.test.ts`). **In real time** (`test:idle-real`, 6 Nov): asleep after 10.02 idle minutes, Docker `paused`, 600 s metered; after resume, the file was there and the same process was alive and still counting. Seen for real too: the owner's own demo workspace slept by itself under `pnpm dev` |
| **Done when:** workspaces can't reach each other | ✅ locally · ⏳ provider | `host.docker.test.ts`, "workspaces can't reach each other…" (5 tests): the other workspace both ways, the proxy's other sides, this computer's addresses (ports 22, 5173, 8787, 8790), metadata, DNS and IPv6, directly and through the proxy. It **fails when the network's gateway isolation is removed** (mutation check, step 7) |
| **Try it** | ✅ recorded · ⏳ provider | `e2e/try-it/phase-1d.spec.ts`, "phase 1d · Try it", with the page's clock for the wait. The real wait is proven by `test:idle-real` |
| Open demo project | ✅ locally | `POST /api/projects/demo` plus the page; walkthrough "open the demo project in one click…". On staging it's honestly absent ("Workspaces run locally for now") |

## How to try it

**Locally** (Docker 28 or newer), after `pnpm dev`:
1. Open http://localhost:5173, sign in, and click **Open demo project**. Watch **Starting…** become **Running · 2 cores**.
2. Click **Terminal** and run `git log --oneline -1`: it's `8e67a21`.
3. Leave it alone for 11 minutes: the card says "Put to sleep after 10 minutes without activity."
4. Click **Resume**.

The full guide is in `docs/build-steps.md`, "Phase 1d so far — run and check it".

**On staging:** projects say "Workspaces run locally for now. Open your projects on your own computer with pnpm dev." There are no workspace buttons. Nothing is faked.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 597 | `pnpm test` (about 75 s) |
| Docker (real containers) | 42 | `pnpm test:docker`; also in CI (job `docker`) |
| Walkthroughs (recorded, production CSP) | 10 | `pnpm test:e2e` |
| Visual and accessibility (catalogue, both themes) | 68 | `pnpm test:visual` |
| Real-time idle check | 1 (about 12 min) | `pnpm --filter @flowcanvas/control-plane test:idle-real` |

**Security:**
- **Canaries are kept nowhere:** `workspace/host/src/no-leaks.docker.test.ts` and `services/control-plane/src/api/no-leaks.test.ts`.
- **Tokens:** the host's token is compared in constant time, and is never kept or shown, even when a host echoes it (mutation-checked).
- **Who may call the host:** browsers are refused (Origin and Host checks).

**Screens** (checked by eye against Figma 32 and 33; the Figma reference isn't compared automatically, decision 29 Oct): the chip's baselines in both themes are in `e2e/visual/__screenshots__/components-workspacestatus--*`, and the page states are in the walkthrough recordings.

## Deviations from plan and why

1. **Containers instead of VMs.** The owner's decision, for the payment reason above. Everything goes through `WorkspaceProvider`, so a provider replaces one adapter (upgrade-later 33). gVisor is an optional hardening meanwhile (upgrade-later 34).
2. **No disk quota.** Docker ignores `--storage-opt size` on overlayfs over btrfs. Disk is measured, and the guard acts on Flowcanvas's total instead (upgrade-later 35).
3. **No Durable Object gateway for terminals.** Locally the host holds the session, so a page reload ends the shell (upgrade-later 36).
4. **The resource guard's plan was corrected** (ADR 0019):
   - Sleeping frees CPU, not memory, so memory pressure stops a workspace.
   - The host measures; the control plane acts, so state and usage stay right.
   - Only old images are removed automatically, never anyone's files.
5. **Screens (step 9.3):**
   - Left out, because the system doesn't have them yet: snapshot steps, progress figures, backups, checkpoints.
   - A requested sleep is never called idle.
   - Resume is a secondary button.
   - The cards sit in project rows until the phase 2 shell, and the chip's popover comes with the top bar.
   - The Starting dot is a ring, not the accent, because Graphite outranks Figma.
6. **Corpus pins are now honoured.** The fork's `main` had moved past the pin. Projects can be pinned, and the demo uses its pin.
7. **The step 6 sign-in fix** (`a3f315b`, the masked "checked as" hint) belongs to 1c, but was found here.

## Decision records added

- 0016 local Docker workspaces
- 0017 the terminal: a pty through Docker's API, relayed by the Worker, xterm.js under our CSP
- 0018 idle sleep: a check every minute; metering until a workspace sleeps or would have
- 0019 the resource guard: the host measures and refuses, the control plane sleeps and stops

## Known issues and follow-ups

- **Waiting for the cloud provider** (upgrade-later 33). The same three *Done when* checks run against staging; then the phase is accepted.
- **Activity is typing and file or command requests only.** Live frames (stage 2) and agents (stage 3) need more signals (upgrade-later 38).
- **Per-project network rules** for running apps (Google Fonts, an app's own APIs): upgrade-later 37.
- **Deleting a project's workspace** arrives with project deletion (upgrade-later 39).
- **One flaky `pnpm test` run** (step 9) was narrowed to the corpus package. It's likely a worker start under memory pressure, which the new worker cap should prevent. To watch in CI.
- **Control-plane tests, after the merge:** `main`'s CI had setup hooks time out, because each test started its own in-process Postgres (about 0.8 s, and near 10 s on a busy runner). Now each test file migrates one Postgres once and each test gets a clone (about 0.2 s), closed when it ends. The full suite takes 17 to 20 s, and its memory low point is 19.0 GiB, against 1.3 GiB before step 10. Follow-up PR after #12.
- **CI's Docker job:** GitHub's runners have Docker 28.0.4, and all 42 Docker tests pass there.
- **Fixed at the PR:** Cloudflare's preview build had failed since step 4. The Worker bundles the host's and the agent's protocol from `dist/`, which Cloudflare's build command didn't build. `turbo.json` now builds them with the web app, and CI runs Cloudflare's exact build on a fresh checkout so it can't fail unseen again.

**Upgrade-later review at phase end:**
- 33–39 are this phase's, each with its trigger.
- None is due before phase 2.
- 32 (rotate the staging GitHub client secret) is still open.

## After the merge (owner)

1. **Migrate staging's database** to 0003 and 0004: done by the owner before the merge (6 Nov, the `production` branch `ep-raspy-frost…`).
2. **On staging, check:**
   - projects load
   - the page says "Workspaces run locally for now"
   - What's new shows 0.5.0

## Next phase preview

**Phase 2, the canvas and app shell:**
- a React Flow canvas with pan, zoom, minimap and selection
- the app shell from Figma 06: the top bar (where the workspace chip and its popover move), the rail, side panels and the review bar
- panels that dock and collapse

**Done when:** 500 dummy nodes pan and zoom smoothly, and the layout matches the Figma shell.
