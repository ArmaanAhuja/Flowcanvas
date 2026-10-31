# Status

One row per phase of the build plan (`docs/reference/build-plan.md`). Status: planned / in progress / in review / accepted.

| Phase | Name | Status | Build | Notes |
| --- | --- | --- | --- | --- |
| 1 | Project skeleton | accepted | `0.1.0` · staging `https://flowcanvas.ahujaarmaan7777.workers.dev` | Accepted on 31 Oct 2026, when CI first ran green on GitHub after the repository moved to `ArmaanAhuja/Flowcanvas` (upgrade-later 8 closed; PR #7, run https://github.com/ArmaanAhuja/Flowcanvas/actions/runs/41183657084). PR #1 had been merged under a recorded exception. Report: `docs/reports/phase-1.md` |
| 1a | Design system in code | accepted | `0.2.0` · staging `https://flowcanvas.ahujaarmaan7777.workers.dev` · catalogue `https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev` | Accepted by the owner on 29 Oct 2026. Merged as `ec07da3` (PR #3) under the PR #1 exception (GitHub Actions blocked, upgrade-later 8). Signal palette adopted; Figma file update pending (upgrade-later 19). Report: `docs/reports/phase-1a.md` |
| 1b | See-and-test harness | accepted | `0.3.0` · staging `https://flowcanvas.ahujaarmaan7777.workers.dev` · reports `https://flowcanvas-reports.ahujaarmaan7777.workers.dev` | Accepted on 31 Oct 2026: the CI workflow ran on GitHub for PR #7 (preview, report, recordings, PR comment) and for its merge `157b55f` (staging, reports' main address), with no manual steps. Report: `docs/reports/phase-1b.md` |
| 1c | Sign-in and control plane | in review | 0.4.0 | Branch `phase/1c-sign-in-control-plane`, PR to `main`. All 10 steps done; report `docs/reports/phase-1c.md`. ADRs 0013–0015. **Owner, after merge, in order** (report, "After the merge"): re-add the Worker secrets (staging OAuth app's keys, a rotated GitHub secret, a new staging VAULT_KEY saved in the password manager first) and deploy that version; migrate staging (0001, 0002) and allow the owner as admin; check `/api/db/ping`; Try it on staging; check Cloudflare's Workers Logs for the secret value and the callback's `code=` and cookies. Accepted after those pass |
| 1d | Workspace sandbox | planned | | Also: the "Open demo project" button (moved from 1b) |
| 2 | Canvas and app shell | planned | | List differences between the prototype screenshots and Figma (decision A5) |
