# The workspace image (phase 1d, ADR 0016): what every project's container starts from.
# The tag is a hash of this file (src/spec.ts), so any change here builds a new image.
# Build it with `pnpm workspace:image` from the repository root.

# Node 24 LTS (matches .nvmrc), pinned by digest so a rebuild gets the same base.
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

# git for clones; ca-certificates for HTTPS; procps (ps, pkill) for the process API and the terminal.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git procps \
  && rm -rf /var/lib/apt/lists/*

# The same pnpm as the repository's packageManager (checked by spec.test.ts). No install scripts.
RUN npm install --global --ignore-scripts pnpm@12.15.0 \
  && npm cache clean --force

# Containers run with a read-only root filesystem, so everything writable lives in the workspace
# volume at /workspace, home directory included. Docker copies this folder's owner into a new volume.
RUN mkdir -p /workspace/.home && chown -R node:node /workspace
ENV HOME=/workspace/.home

# Telemetry off by default (CLAUDE.md rule 5), for the tools a cloned web project is likely to run.
ENV DO_NOT_TRACK=1 \
  NEXT_TELEMETRY_DISABLED=1 \
  npm_config_update_notifier=false \
  npm_config_fund=false

# The `node` user (uid 1000); the container is also started with --user 1000:1000.
USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
