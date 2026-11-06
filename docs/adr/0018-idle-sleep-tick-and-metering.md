# 0018 — Idle sleep: a once-a-minute tick; metering until a workspace sleeps or would have

- Status: accepted
- Date: 5 Nov 2026
- Phase: 1d, step 8

## Context

The *Done when* says a workspace sleeps after 10 idle minutes and resumes intact. Step 3 built the pieces: `sleepIdleWorkspaces()`, `touchWorkspace()` (typing in a terminal; using the file and command API), and usage written on sleep and stop. Nothing called `sleepIdleWorkspaces()` yet, and three questions were open:
1. What runs it?
2. How does the month's usage stay current while a workspace runs?
3. What gets counted when nothing was there to put a workspace to sleep (the laptop was shut, or `pnpm dev` stopped)?

Checked on 5 Nov 2026:
- Cloudflare's docs say local development doesn't run Cron Triggers automatically.
- Wrangler 4.152 confirms it at start-up, and it runs the scheduled handler on `GET /cdn-cgi/local/scheduled`, with no flag needed.
- The free plan allows 5 Cron Triggers per account, at 10 ms of CPU per run. Waiting for the database doesn't count as CPU.

## Options considered

**What runs it:**
- **A Cron Trigger, every minute** (`* * * * *`) on the Worker's `scheduled` handler. Locally, `services/control-plane/scripts/dev.ts` starts `wrangler dev` unchanged and calls the local endpoint every minute. *Chosen.* The same code runs locally and deployed, and only the trigger differs.
- **A timer in the workspace host.** Rejected. The host doesn't know the database, so the state would live in two places, and usage would be lost.
- **Checking on each API request.** Rejected. It doesn't fire when nobody's looking at the page, which is exactly when a workspace should sleep.
- **A Durable Object alarm per workspace.** It's exact, but more than the local stand-in needs. It's a fit for the cloud provider later (upgrade-later 36 already moves terminals into Durable Objects).

**Keeping usage current:**
- **The tick writes records for long-running workspaces.** Rejected. A tick moving `running_since` races a person's Sleep or Stop, which reads it, so seconds can be counted twice unless every action retries.
- **The usage total adds live seconds** (running workspaces, from the later of their start and the month's start). Records are still written only on sleep and stop. *Chosen.* There are no extra writes and no races, and records stay split by month.

**When nothing put it to sleep:**
- Count until now. Rejected. A laptop shut overnight would count 12 hours.
- **Count until it sleeps, or until it would have slept** (last activity + 10 minutes), whichever is earlier. *Chosen.* It matches the sleep rule, and it never charges for time nobody could use.

## Decision

- **The tick:**
  - `src/api/scheduled.ts` runs `sleepIdleWorkspaces()`.
  - `wrangler.jsonc` has `triggers.crons: ["* * * * *"]`, and `pnpm dev` ticks locally (`scripts/dev.ts`).
  - Where no provider is configured (staging, for now) the tick returns without opening the database.
  - Failures are logged redacted and never thrown.
- **Metering:**
  - `meteredUntil(lastActive, now) = min(now, lastActive + 10 min)`, in `src/workspaces/policy.ts`. Sleep and stop record up to it, and `usageSummary()` adds live seconds up to it.
  - Activity is still only what the person does (typing, file and command requests). Output alone doesn't keep a workspace awake.

## Consequences

- A workspace sleeps between 10 and 11 minutes after its last activity, because the tick runs once a minute.
- A person watching without typing for 10 minutes gets the workspace put to sleep, and that time isn't counted. This is fine while the terminal is the only view. Stage 2 (live frames) and stage 3 (agents running on their own) need more activity signals (upgrade-later 38).
- A long command that runs with no typing (a big `pnpm install`) is frozen by sleep and carries on when resumed.
- On staging, the trigger runs every minute and does nothing. It's 1 of the account's 5 free triggers, and 1,440 runs a day.
- A host restart while a workspace "runs" shows up at the next tick: pausing finds it gone, so it becomes stopped, metered up to its last activity + 10 minutes.
