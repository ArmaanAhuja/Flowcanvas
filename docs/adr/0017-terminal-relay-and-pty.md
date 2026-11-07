# 0017 — The terminal: a pty through Docker's API, relayed by the Worker, xterm.js under our CSP

- Status: accepted
- Date: 4 Nov 2026
- Phase: 1d, step 6

## Context

Phase 1d's Try it includes "run a command in the terminal". The browser needs an interactive shell inside the project's workspace: a real pty (so programs see a terminal, colours and resizing work), carried over a WebSocket. That WebSocket has to be authenticated as the project's owner and work through the same origin as the app. The plan's step list said "Durable Object WebSocket gateway". Three things were checked first (4 Nov 2026, this machine):

| Question | Result |
| --- | --- |
| A pty in a workspace container without native modules | Docker Engine API over its Unix socket: `POST /containers/{id}/exec` with `Tty: true`, then `POST /exec/{id}/start` upgraded to a raw stream. bash ran on `/dev/pts/0`, `POST /exec/{id}/resize?h=33&w=101` was seen by `stty size`, and the exit code (7) came back from `GET /exec/{id}/json` |
| A Worker in `wrangler dev` relaying a WebSocket to a service on 127.0.0.1 | Works: `fetch(url, { headers: { upgrade: 'websocket', authorization } })` gives `response.webSocket`; a `WebSocketPair` faces the browser. **Binary frames arrived as `Blob`s** (sent on as the text `[object Blob]`) until both sockets had `binaryType = 'arraybuffer'` |
| xterm.js 6.0.0 under `style-src 'self'` | It creates `<style>` elements in three places: the scroll area (whatever renderer) and the DOM renderer's dimensions and theme. The CSP blocks their contents, and the WebGL renderer wouldn't remove the scroll area's |

## Options considered

1. **The pty:**
   - **Docker Engine API with `Tty: true` (chosen)**
   - `docker exec -it` through node-pty: a native module, needs install scripts (ADR 0006 denies them)
   - `script` inside the container: no way to resize from outside
2. **The gateway:**
   - **the app's Worker relays the WebSocket to the workspace host (chosen for now)**
   - a Durable Object per session: the place to keep a session alive across reconnects and to share it between viewers. Locally, the workspace host already is that stateful place, so a Durable Object would add a class, a migration and a hop with nothing to hold yet. It comes with the cloud provider, when the host isn't on the same machine (upgrade-later 33)
3. **xterm.js and the CSP:**
   - **move xterm's `<style>` text into constructed stylesheets (`document.adoptedStyleSheets`) (chosen)**
   - add `'unsafe-inline'` to `style-src`: weakens a rule the project treats as non-negotiable (CLAUDE.md section 7)
   - a nonce per response: the pages are static assets (ADR 0005), and xterm has no nonce option
   - the WebGL renderer: still leaves the scroll area's styles

## Decision

```
xterm.js ──WebSocket /api/projects/:id/workspace/terminal (same origin, cookie, Origin checked)──► Worker
  binary frames: terminal bytes        text frames: JSON control ({ type: 'resize', cols, rows } in;
                                                    { type: 'exit', code } and { type: 'error', message } out)
Worker ──WebSocket, bearer token──► workspace host /v1/workspaces/:ref/terminal ──Engine API exec, Tty──► bash
```

- **The workspace host opens the pty** through the Docker Engine API on its Unix socket (`DOCKER_HOST` if it's `unix://`, else `/var/run/docker.sock`): `bash -l` as uid 1000, `TERM=xterm-256color`, in `/workspace/project` (or `/workspace` without a repository). It resizes with the Engine API and reports the exit code. Closing the WebSocket closes the stream, which hangs up the shell.
- **The Worker relays.** It only accepts the upgrade after the same checks as the other workspace routes: signed in, `Origin` ours (against cross-site WebSocket hijacking), the project's owner, the workspace running. It sets `binaryType = 'arraybuffer'` on both sides, accepts only resize messages and bounded frames from the browser, and counts input as activity (at most once every 30 seconds).
- **One shell per connection,** for now. Closing the page ends it; reconnecting starts a new one. Keeping sessions across reconnects, with their scrollback, is upgrade-later 33.
- **xterm.js 6 with its own stylesheet bundled** (served from our origin, so the CSP allows it). A small shim watches the terminal's element and copies each `<style>` element's text into a constructed stylesheet. Only our own scripts can create one, and `script-src 'self'` already limits scripts to ours, so the CSP's protection is unchanged. A walkthrough checks it under the deployed CSP.

## Consequences

- No native dependencies. The host gains `ws` (MIT, already in the dependency tree through Wrangler) for its WebSocket server.
- Terminal colours come from the design tokens at runtime (CSS variables read into xterm's theme), so they follow the theme without hard-coded values.
- A refreshed page loses the shell and its scrollback until upgrade-later 33.
- The cloud provider brings the Durable Object gateway. The browser's side of the protocol stays the same.
