# 0022 — File sync with the workspace: versions, the journal and the watcher

- Status: accepted
- Date: 7 Nov 2026
- Phase: 3, steps 2 and 3

## Context

Phase 3's editor keeps the buffer in the browser and syncs it to the workspace (research report: "the editor buffer lives in the browser so typing is instant"). *Done when:* edits survive closing the tab and reopening, and an edit made in the terminal appears in the editor. CLAUDE.md rule 5a: never lose work. The terminal, other tabs and, later, coding agents all change the same files, so the editor must never overwrite a change it hasn't seen.

## Decisions

### 1. A file's version is the SHA-256 of its bytes

Every read and write returns it. It's independent of clocks and file systems: the same bytes always give the same version.

*Rejected:*
- modification times, which have coarse resolution and survive identical rewrites
- a counter, which nothing outside the agent would keep

### 2. Saves are conflict-safe (optimistic concurrency)

A write carries `baseVersion`, the version the content was edited from. The agent refuses it with `conflict` (409 through the API) if the file isn't that version any more. `null` means "must not exist yet". Writes to one file are serialised inside the agent, so two saves from the same version can't both pass. Without `baseVersion`, a write is unconditional, as in phase 1d.

There remains a window of a few milliseconds between the check and the write in which another program could change the file. The watcher reports that change, so it's shown rather than lost.

*Rejected:*
- locks, because the terminal and other programs don't take them
- last write wins, which silently loses work

### 3. The journal lives in the workspace, outside the project

Unsaved buffers are kept in `/workspace/.flowcanvas/journal`:
- in the volume, so they survive sleep, stop and start
- outside `/workspace/project`, so git, the dev server, the file list and the watcher never see them

Each entry is one JSON file, named by a hash of its path, written to a temporary name and renamed into place. A rising `revision` means a late put never replaces newer edits, and a drop after a save never removes edits made after it. Limits: 1 MB per entry and 500 entries. The page adds a copy in IndexedDB in step 6, for when the workspace can't be reached.

*Rejected:*
- the browser only: it's lost with the browser's storage, and invisible on another computer
- writing straight into the project's files on every keystroke: that sends half-typed code to the dev server and tests. Autosave after 5 s writes the real file (owner, 7 Nov).

### 4. The file list comes from git

`git ls-files --cached --others --exclude-standard`, minus deleted files, so the tree and quick-open show what the project considers its files. Without a repository, it walks the folders, skipping `node_modules`, `.git` and build output. `.env` files never appear.

### 5. The watcher is its own process per open page

`main.js --watch` is the same agent bundle, started with `docker exec` when a page opens the events channel. It ends when the page goes: the host ends its stdin, and kills it after 2 s as a backstop. The request agent stays separate, so a burst of changes never delays a save. It's capped at 4 per workspace, about one per tab.

- **It watches folders, not files** (`sed -i` replaces the file), and skips `node_modules`, `.git` and build output. Each folder takes one inotify watch from a pool the whole computer shares: Rallly is 599 folders, against 524,288 on the owner's laptop.
- **Events:**
  - `ready` (folders and files)
  - `changed` (path, `deleted`, and the new `version`, or null when deleted or over 1 MB)
  - `overflow`, when over 500 paths change at once (a checkout, an install): the page reloads the list and re-checks open files
  - `error`
- **Repeated notifications for one save** are coalesced (50 ms), and a rewrite with the same content says nothing.
- **Never about secret files.**

### 6. Events reach the page over one WebSocket, checked at every hop

The route is workspace → host (`/v1/workspaces/:ref/events`) → control plane (`/api/projects/:id/workspace/events`, same-origin, owner only) → page.
- The workspace is untrusted, so the host and the control plane each check every event with `parseWatchEvent`. Paths must be relative, must not go up, mustn't be in ignored folders, and mustn't be secret files. Versions must be well-formed.
- It's one way: nothing from the page reaches the workspace.
- The logs name the workspace and person, never a file.

### 7. Watching is not activity

An open events channel never touches `last_active_at`, so a page left open overnight lets the workspace sleep (CLAUDE.md section 7, cost). Reads, saves and journal writes still count, as before.

## Consequences

- **Measured in a real Rallly workspace:** a `sed -i` reached the page's socket in **162 ms**, about 100 ms of it Docker starting `sed`. The watcher process is gone within 5 s of the page closing (Docker test; the check is shown to find the watcher while it runs).
- **Protocol 2** of the agent. The host copies the agent in on every connection, and copies are now atomic, so the request agent and a watcher never start from a half-written file.
- **A cloud provider** (upgrade-later 33) implements `events(ref)` like `terminal(ref)`.
- **The page's side** (showing changes, conflicts and restores) is steps 5 to 7.

## Addendum (8 Nov 2026, phase 3 step 6): the page's side of the journal, and autosave

- **Two copies of unsaved changes:**
  - **the workspace's journal,** every 2 s while a file has unsaved changes, and once more as the page is hidden or closed (a `keepalive` request, which outlives the page; at most 60 KiB, the browser's limit)
  - **this browser's IndexedDB,** within 300 ms of each edit (it's local and cheap, so a tab closed right after typing still has it), and at every journal write
- **Revisions are times** (`max(previous + 1, now)`): they keep rising across reloads, so the newer of two copies always wins.
- **Restoring:** when a file opens, the newer copy is used if its text differs from the file on disk; a copy equal to the file is dropped. If the copy's base isn't the file's version any more (the file changed after the edit), its saves are checked against that old base. The workspace then refuses them, and the page shows the conflict at once. A restore never overwrites a newer change. Files in the workspace's journal open too, even if they weren't open in this browser.
- **Autosave** (owner, 7 Nov 2026), on by default, with a switch in the status bar remembered per browser: 5 s after the last keystroke, and when you switch file, **leave** the Code view or leave the window. Never for a file in conflict, and never on arriving (restored changes stay unsaved until you act or leave). A save drops the journal's copies up to its own revision.
- **Line breaks:** a file with `\r\n` keeps them. CodeMirror's `doc.toString()` always joins lines with `\n`, so saves and the journal use `state.sliceDoc()`, which honours the file's separator.
- **Tested in a real browser:** edit, close the tab at once, reopen: the change is back, marked unsaved, with a note; autosave writes it after 5 s; a fresh browser restores from the workspace's copy alone. Playwright can't intercept `keepalive` requests, so the walkthrough checks that the workspace received the 2-second write or that the page sent the close-time one (recorded, test-only).
