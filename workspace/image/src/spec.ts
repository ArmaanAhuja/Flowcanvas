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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function checkName(kind: string, value: string): string {
  if (!NAME.test(value)) throw new Error(`Invalid ${kind} name: ${JSON.stringify(value)}`);
  return value;
}

function checkImage(image: string): string {
  if (!/^flowcanvas-workspace:[0-9a-f]{12}$/.test(image)) {
    throw new Error(`Invalid image: ${JSON.stringify(image)}`);
  }
  return image;
}

/** Every Docker object we create has these labels, so clean-up and the resource guard find exactly ours. */
export const LABEL = {
  ours: 'org.flowcanvas.workspace',
  prefix: 'org.flowcanvas.prefix',
  role: 'org.flowcanvas.role',
  workspaceId: 'org.flowcanvas.workspace-id',
} as const;

function labels(prefix: string, role: 'workspace' | 'egress', workspaceId?: string): string[] {
  return [
    '--label',
    `${LABEL.ours}=1`,
    '--label',
    `${LABEL.prefix}=${checkName('prefix', prefix)}`,
    '--label',
    `${LABEL.role}=${role}`,
    ...(workspaceId === undefined ? [] : ['--label', `${LABEL.workspaceId}=${workspaceId}`]),
  ];
}

/** The egress proxy: the only way out of a workspace (ADR 0016). Workspaces reach it by container name. */
export const EGRESS_PORT = 3128;

/**
 * `docker network create` arguments for a workspace's own network: no route out (`--internal`), and no
 * host address on it (isolated gateway mode, Docker 28+), so the host and other workspaces are unreachable.
 */
export function networkCreateArgs(network: string, prefix: string): string[] {
  return [
    'network',
    'create',
    '--internal',
    '--opt',
    'com.docker.network.bridge.gateway_mode_ipv4=isolated',
    ...labels(prefix, 'workspace'),
    checkName('network', network),
  ];
}

/** The egress proxy's own way out: an ordinary bridge to the internet, with nothing else on it. */
export function egressNetworkCreateArgs(network: string, prefix: string): string[] {
  return [
    'network',
    'create',
    '--opt',
    'com.docker.network.bridge.enable_icc=false',
    ...labels(prefix, 'egress'),
    checkName('network', network),
  ];
}

export interface RunOptions {
  /** Container name. */
  name: string;
  /** Prefix of every name this workspace host creates (`fc`; tests use their own). */
  prefix: string;
  workspaceId: string;
  network: string;
  /** Named volume holding the workspace's files, mounted at /workspace. */
  volume: string;
  /** Container name of the egress proxy, reachable on the workspace's network. */
  egress: string;
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
  if (!UUID.test(options.workspaceId)) {
    throw new Error(`Invalid workspace ID: ${JSON.stringify(options.workspaceId)}`);
  }
  const proxy = `http://${checkName('egress', options.egress)}:${String(EGRESS_PORT)}`;
  return [
    'run',
    '--detach',
    '--name',
    checkName('container', options.name),
    '--hostname',
    'workspace',
    ...labels(options.prefix, 'workspace', options.workspaceId),
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
    // Tools that honour the usual proxy variables (git, npm, pnpm, curl) go out through the egress proxy.
    '--env',
    `HTTPS_PROXY=${proxy}`,
    '--env',
    `https_proxy=${proxy}`,
    // A private repository fails at once instead of waiting for a password nobody can type.
    '--env',
    'GIT_TERMINAL_PROMPT=0',
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
    checkImage(options.image),
  ];
}

export interface EgressRunOptions {
  name: string;
  prefix: string;
  /** Its own way out (egressNetworkCreateArgs); workspace networks are connected to it later. */
  network: string;
  image: string;
  /** Absolute path of the proxy's script on this machine, mounted read-only. */
  script: string;
  /** Stored as a label, so a changed script or image means a new container. */
  version: string;
}

/** `docker run` arguments for the egress proxy, as locked down as a workspace and much smaller. */
export function egressRunArgs(options: EgressRunOptions): string[] {
  if (!options.script.startsWith('/') || /[:,\n]/.test(options.script)) {
    throw new Error(`Invalid script path: ${JSON.stringify(options.script)}`);
  }
  if (!/^[0-9a-f]{12}$/.test(options.version)) {
    throw new Error(`Invalid version: ${JSON.stringify(options.version)}`);
  }
  return [
    'run',
    '--detach',
    '--name',
    checkName('container', options.name),
    ...labels(options.prefix, 'egress'),
    '--label',
    `org.flowcanvas.egress-version=${options.version}`,
    '--user',
    WORKSPACE_USER,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--network',
    checkName('network', options.network),
    // It's attached to every workspace's network; it must never pass packets between them.
    '--sysctl',
    'net.ipv4.ip_forward=0',
    '--sysctl',
    'net.ipv6.conf.all.forwarding=0',
    '--volume',
    `${options.script}:/opt/egress/proxy.ts:ro`,
    '--cpus',
    '0.5',
    '--memory',
    String(256 * 1024 ** 2),
    '--memory-swap',
    String(256 * 1024 ** 2),
    '--pids-limit',
    '64',
    '--init',
    '--log-driver',
    'none',
    '--restart',
    'no',
    checkImage(options.image),
    'node',
    '/opt/egress/proxy.ts',
  ];
}
