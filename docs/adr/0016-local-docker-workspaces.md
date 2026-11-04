# 0016 — Workspaces in local Docker containers, behind a provider interface

- Status: accepted
- Date: 4 Nov 2026
- Phase: 1d, step 1 (spike)

## Context

Phase 1d needs one isolated workspace per project: clone a repo, a file and process API, a terminal, outbound network rules, limits, and sleep and resume. The build plan asks for VMs from a managed sandbox provider. E2B, the chosen provider, needed a $5 payment before it would issue an API key, so the owner chose local Docker containers for now and a cloud provider later (decisions log, 4 Nov 2026; upgrade-later 33).

The control plane runs in the app's Worker (ADR 0013). Locally that's `wrangler dev`. On staging it runs on Cloudflare, which can't reach a laptop.

## Spike results (4 Nov 2026, this machine: Docker 29.9.2, cgroup v2, runc, Docker's built-in seccomp profile)

| Question | Result |
| --- | --- |
| Clone Rallly (pinned fork commit, shallow fetch of that one commit, 52 MB, 1,947 files) in a locked-down container | 6.2 s with the container already created; 7.0 s and 7.5 s for start, clone and exit together. The image was already built, as the workspace image will be |
| `docker pause` / `unpause` | About 50 ms each way. Same PID before and after. A once-a-second counter didn't advance while paused, then carried on. Files were kept. A paused idle container held 7 MiB |
| Two containers, each on its own `--internal` network | Couldn't reach each other (TCP or ping), the internet, or 169.254.169.254 |
| …but the host | **Reachable** at the network's gateway and at other bridge addresses (connection refused, so packets arrive). Anything on the host listening on all interfaces would be exposed |
| Internal network with `com.docker.network.bridge.gateway_mode_ipv4=isolated` (Docker 28+) | The host has no address on that network. The container's only route is its own subnet. The host, other bridges and the home router are all "Network is unreachable". The host can't reach the container's address either |
| Host ↔ container over one long-lived `docker exec -i` stdio stream | 200 messages: p50 0.68 ms, p99 1.22 ms. A fresh `docker exec` per call costs about 105 ms |
| The Worker in `wrangler dev` calling a token-checked HTTP service on 127.0.0.1 | Works, 3–4 ms per call |

## Options considered

1. **Container networking:**
   - default bridge: reaches the internet, the host and other containers
   - `--internal` only: no internet, but reaches the host
   - **`--internal` with the isolated gateway mode (chosen)**
   - `--network none`: no network at all, so no egress proxy either
2. **Host to agent:**
   - **a long-lived `docker exec -i` stream (chosen)**
   - an HTTP port on the container's address: needs a non-isolated network, which the isolation test rules out
   - a Unix socket in a shared volume: works, but puts a host-side socket next to untrusted files
3. **Who drives Docker:**
   - **a separate local workspace host process (chosen)**
   - the Worker calling the Docker Engine API over TCP: exposes a root-equivalent API on a port
   - Vite's dev server: mixes concerns and dies with the page build

## Decision

```
browser ──► Worker /api (wrangler dev) ──HTTP, 127.0.0.1, bearer token──► workspace host (Node, workspace/host)
                                                                            │  docker CLI / Engine socket
                                                                            ▼
                         workspace container (our image, non-root) ◄── docker exec -i: JSON lines ──► agent (workspace/agent)
                           network: own --internal net, gateway_mode_ipv4=isolated
                           egress: only through the egress proxy (allowlisted hosts)
                           files: a named volume per workspace
```

- **`WorkspaceProvider` interface in the control plane.** The Docker adapter calls the local workspace host. A cloud adapter replaces it later; nothing else changes.
- **The workspace host is the only thing that touches Docker.** It listens on 127.0.0.1 only and needs `WORKSPACE_HOST_TOKEN` (`.dev.vars`). It also refuses any request with an `Origin` header or a Host that isn't 127.0.0.1 or localhost, so a web page in the browser can't drive it: a page can reach 127.0.0.1, but can't drop Origin or fake Host (added in step 4). It runs a fixed set of operations (create, start, pause, resume, stop, remove, exec the agent, open a terminal). Image, mounts, networks, limits and flags are its own constants, never taken from a request.
- **Each workspace:**
  - a container from our image (step 2)
  - non-root, `--cap-drop ALL`, `no-new-privileges`, Docker's default seccomp profile
  - `--cpus`, `--memory`, `--pids-limit`
  - no Docker socket inside
  - its own internal network in isolated gateway mode (the host refuses to start on Docker older than 28)
  - a named volume for its files
- **Internet only through an egress proxy** on the workspace's network. It's one shared proxy container, connected to every workspace network with IP forwarding turned off (`net.ipv4.ip_forward=0`; Docker had it on), so it can't route between them, with an allowlist (GitHub for clones and the npm registry to start). It resolves names itself and refuses private, loopback and link-local addresses. A minimal proxy comes with the clone (step 4); the rules and the isolation test, in step 7.
- **Host ↔ agent:** typed, versioned JSON-lines messages over one `docker exec -i` stream per workspace. No ports are opened on the container.
- **Sleep is `docker pause`** (the cgroup freezer): memory and processes stay frozen in place, so "resumes intact" holds. After a host restart a workspace comes back stopped, with its volume kept.
- **Staging has no workspace host,** so its API answers "Workspaces run locally for now" and the UI says the same.

## Consequences

- Containers share the host's kernel, so isolation is weaker than the VMs the build plan asks for (risk R1). gVisor or rootless Docker would harden it (upgrade-later 34). The cloud provider (upgrade-later 33) brings real VMs.
- Paused workspaces keep their memory. That's fine for a few local workspaces; real snapshots come with the provider.
- The *Done when* checks can run against real containers locally, and in CI where runners have Docker 28+. Staging can't run them until a provider is connected, so phase 1d closes "in review".
- `docker exec` streams depend on the Docker CLI or socket being on the machine. The local runner (phase 48a) will need the same, or its own runtime.
- The clone timing measured here is on a home connection, with no proxy yet. Step 4 measures it again through the egress proxy.
