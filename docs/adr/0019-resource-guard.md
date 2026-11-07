# 0019 — The resource guard: the host measures and refuses, the control plane sleeps and stops

- Status: accepted
- Date: 5 Nov 2026
- Phase: 1d, step 8a

## Context

Until a cloud provider is connected, workspaces run on the owner's laptop. The owner asked (4 Nov 2026) that Flowcanvas stays within a budget there and acts when the laptop is under pressure, touching only its own things. The plan (build steps, "On the owner's laptop") set the numbers:
- 2 workspaces running at once
- 25 GiB of disk for Flowcanvas
- pressure below 4 GiB of available memory, below 50 GiB of free disk, or above a load of 14 for 2 minutes

It listed the actions in order: refuse, sleep idle workspaces, stop the least recently used, remove what isn't needed. The guard was to run in the workspace host every 30 seconds.

Two things learned since the plan was written changed how it's built:
1. **`docker pause` keeps a workspace's memory** (the cgroup freezer freezes its processes in place, which is why resume is intact). So sleeping frees CPU, not memory. Only stopping frees memory.
2. **The database is the source of truth** for a workspace's state and its usage (steps 3 and 8). If the host paused or stopped containers on its own, the page would show the wrong state, and the meter would be wrong until the next reconciliation.

## Options considered

- **The host does everything** (the plan as written). Rejected, for point 2: the host doesn't know the database.
- **The control plane measures the laptop.** Impossible. The Worker runs in workerd, with no view of the machine's memory or Docker.
- **Split** (*chosen*). Each side does what it can see:
  - **The host measures and refuses.** `ResourceGuard` (`workspace/host/src/guard.ts`) reads memory, free disk and load every 30 s. It measures Flowcanvas's own disk every 5 minutes, because Docker takes about 4 s to size every volume. The host refuses to create or start a workspace under any pressure. It refuses to resume one only when the laptop is busy, since a paused workspace already holds its memory and disk. Under disk pressure it removes old tags of our workspace image (Docker refuses one a container still uses). It answers `GET /v1/pressure`.
  - **The control plane acts through the lifecycle.** The minute tick (ADR 0018) asks for pressure and changes one workspace per tick, so state, usage and the reason are recorded like any other change:
    - **memory:** stop the least recently used workspace, asleep ones first
    - **load:** put the least recently used running one to sleep

## Decision

- **Budget:** the numbers above (`BUDGET` in `resources.ts`, pinned by a test).
- **Sustained load** means every sample for 2 minutes was above 0.9 × cores. One low sample starts the 2 minutes again.
- **Disk:** only old workspace images are removed automatically. Nothing that holds a person's work (containers, volumes) is removed by the guard. Projects can't be deleted yet, so no workspace volume can be orphaned. When deletion comes, it must remove its own workspace: a requirement on that feature, not a gap left here.
- **Reasons the person sees** are stored in the workspace's `failure` field (step 9 shows them), and cleared when the person next opens it:
  - "Stopped to free memory on this computer. Its files are kept: open it to start it again."
  - "Put to sleep because this computer was very busy. Resume it when you need it."
- **Refusals** carry the guard's sentence through the existing `refused` path, for example "This computer is low on memory (under 4 GiB available), so a workspace can't start now…".
- **A test-only hook,** `WORKSPACE_HOST_TEST_PRESSURE`, makes a host report pressure, because real pressure can't be made safely on the laptop. The host refuses to start with it under the real `fc` prefix.

## Consequences

- **The guard acts within about 1.5 minutes** of pressure starting: up to 30 s to sample, then up to 60 s for the tick. Load needs 2 minutes more.
- **Load average lags,** so after one workspace sleeps for load, the next tick may sleep the other before the average has fallen. That's at most 2 workspaces, and resuming is one click once the laptop is quiet.
- **The host can't act alone,** because only the control plane changes state. If `wrangler dev` isn't running, nothing is slept or stopped, but refusals still work. Both run together under `pnpm dev`.
- **A cloud provider has no `pressure()`.** Its own limits apply, and the control plane does nothing.
