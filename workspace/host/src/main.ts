// `pnpm dev` starts this alongside the app (turbo): the local workspace host on 127.0.0.1 (ADR 0016).
// Without a token or Docker it explains what's missing and exits quietly, so `pnpm dev` still runs the rest.
import { buildImage } from '@flowcanvas/workspace-image';
import { dockerCli } from './docker-cli.js';
import { DEFAULT_PORT } from './protocol.js';
import { createHostServer } from './server.js';
import { WorkspaceHost } from './workspaces.js';

const MIN_DOCKER_MAJOR = 28;
const log = (line: string) => {
  console.log(`[workspace-host] ${line}`);
};

const token = process.env.WORKSPACE_HOST_TOKEN ?? '';
const port = Number(process.env.WORKSPACE_HOST_PORT ?? DEFAULT_PORT);
// Tests run their own host with their own prefix, so they never touch real workspaces.
const prefix = process.env.WORKSPACE_HOST_PREFIX ?? 'fc';
if (!/^fc(-test-[0-9a-f]{4,16})?$/.test(prefix)) {
  log(`Not started: WORKSPACE_HOST_PREFIX must be fc or fc-test-<hex>.`);
  process.exit(1);
}

if (token.length < 32) {
  log(
    'Not started: WORKSPACE_HOST_TOKEN is missing from .dev.vars (or shorter than 32 characters).',
  );
  log("Add one with: printf '\\nWORKSPACE_HOST_TOKEN=%s\\n' (openssl rand -hex 32) >> .dev.vars");
  process.exit(0);
}

let dockerVersion = '';
try {
  dockerVersion = (await dockerCli(['version', '--format', '{{.Server.Version}}'])).stdout;
} catch {
  log("Not started: Docker isn't running on this computer. Start Docker, then restart pnpm dev.");
  process.exit(0);
}
if (Number(dockerVersion.split('.')[0]) < MIN_DOCKER_MAJOR) {
  log(
    `Not started: Docker ${dockerVersion} is too old; workspaces need ${String(MIN_DOCKER_MAJOR)} or newer.`,
  );
  process.exit(0);
}

const host = new WorkspaceHost({ docker: dockerCli, prefix, image: () => buildImage(), log });
const server = createHostServer({ host, token, port, log });
// Another `pnpm dev` already has the port: step aside instead of taking this one down with a crash.
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  log(`Not started: port ${String(port)} is in use. Is pnpm dev already running in another terminal?`);
  process.exit(0);
});
server.listen(port, '127.0.0.1', () => {
  log(`Listening on http://127.0.0.1:${String(port)} (Docker ${dockerVersion})`);
});
