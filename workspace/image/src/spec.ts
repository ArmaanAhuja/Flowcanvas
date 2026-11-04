// How a workspace container is built and started (ADR 0016). The workspace host (step 4) is the only
// caller, and it never passes through anything from a request: names are checked, flags are fixed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const DOCKERFILE_URL = new URL('../Dockerfile', import.meta.url);
export const WORKSPACE_DIR = '/workspace';
export const WORKSPACE_USER = '1000:1000';

const GiB = 1024 ** 3;

export interface WorkspaceLimits {
  cpus: number;
  memoryBytes: number;
  pids: number;
  tmpBytes: number;
  /** Not enforced by Docker on every storage driver (btrfs isn't); the host measures the volume (step 8). */
  diskBytes: number;
}

// Enough for a Next.js dev server and a TypeScript build (Rallly), small enough for a laptop.
export const WORKSPACE_LIMITS: Readonly<WorkspaceLimits> = Object.freeze({
  cpus: 2,
  memoryBytes: 4 * GiB,
  pids: 1024,
  tmpBytes: 1 * GiB,
  diskBytes: 10 * GiB,
});

/** `flowcanvas-workspace:<first 12 hex of the Dockerfile's SHA-256>`: a new tag whenever the file changes. */
export function imageTag(dockerfile: string = readFileSync(DOCKERFILE_URL, 'utf8')): string {
  return `flowcanvas-workspace:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)}`;
}

// Docker object names we create. Starting with a letter or digit also means a name can't be read as a flag.
const NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

function checkName(kind: string, value: string): string {
  if (!NAME.test(value)) throw new Error(`Invalid ${kind} name: ${JSON.stringify(value)}`);
  return value;
}

/**
 * `docker network create` arguments for a workspace's own network: no route out (`--internal`), and no
 * host address on it (isolated gateway mode, Docker 28+), so the host and other workspaces are unreachable.
 */
export function networkCreateArgs(network: string): string[] {
  return [
    'network',
    'create',
    '--internal',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv4=isolated',
    '--label',
    'org.flowcanvas.workspace=1',
    checkName('network', network),
  ];
}

export interface RunOptions {
  /** Container name. */
  name: string;
  network: string;
  /** Named volume holding the workspace's files, mounted at /workspace. */
  volume: string;
  image: string;
  limits?: Partial<WorkspaceLimits>;
}

/** `docker run` arguments for a workspace container, locked down as far as containers allow (risk R1). */
export function runArgs(options: RunOptions): string[] {
  const limits = { ...WORKSPACE_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`Invalid limit ${key}: ${String(value)}`);
  }
  const image = options.image;
  if (!/^flowcanvas-workspace:[0-9a-f]{12}$/.test(image))
    throw new Error(`Invalid image: ${JSON.stringify(image)}`);
  return [
    'run',
    '--detach',
    '--name',
    checkName('container', options.name),
    '--hostname',
    'workspace',
    '--label',
    'org.flowcanvas.workspace=1',
    '--user',
    WORKSPACE_USER,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,size=${String(Math.floor(limits.tmpBytes))}`,
    '--volume',
    `${checkName('volume', options.volume)}:${WORKSPACE_DIR}`,
    '--network',
    checkName('network', options.network),
    '--cpus',
    String(limits.cpus),
    '--memory',
    String(Math.floor(limits.memoryBytes)),
    // Same as --memory: no swap on top.
    '--memory-swap',
    String(Math.floor(limits.memoryBytes)),
    '--pids-limit',
    String(Math.floor(limits.pids)),
    // A tiny init reaps orphaned processes, which terminals and dev servers leave behind.
    '--init',
    // Nothing is read from the container's output, and it could hold a project's secrets.
    '--log-driver',
    'none',
    '--restart',
    'no',
    image,
  ];
}
