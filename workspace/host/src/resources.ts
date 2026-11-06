// The laptop's figures and Flowcanvas's share of them, against the owner's budget (build-steps, phase 1d,
// "On the owner's laptop"). `pnpm workspace:resources` prints them; the resource guard (step 8a) acts on them.
import { readFile, statfs } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import { LABEL } from '@flowcanvas/workspace-image';
import type { Docker } from './docker-cli.js';
import { MAX_RUNNING } from './workspaces.js';

const GiB = 1024 ** 3;

export const BUDGET = {
  maxRunning: MAX_RUNNING,
  flowcanvasDiskBytes: 25 * GiB,
  minAvailableMemoryBytes: 4 * GiB,
  minFreeDiskBytes: 50 * GiB,
  /** The 1-minute load per core above which the laptop counts as busy (sustained for 2 minutes, step 8a). */
  maxLoadPerCore: 0.9,
  /** How long the load has to stay above that before the guard acts. */
  loadSustainedMs: 2 * 60_000,
} as const;

export interface Figures {
  readonly memoryTotalBytes: number;
  readonly memoryAvailableBytes: number;
  readonly diskFreeBytes: number;
  readonly load1: number;
  readonly cores: number;
  readonly running: number;
  readonly asleep: number;
  readonly imagesBytes: number;
  readonly volumesBytes: number;
}

export interface Check {
  readonly name: string;
  readonly value: string;
  readonly limit: string;
  readonly ok: boolean;
}

/** Docker's human sizes ("559MB", "138.9kB", "0B") in bytes; Docker uses powers of 1000. */
export function parseDockerSize(text: string): number {
  const match = /^([\d.]+)\s*(B|kB|KB|MB|GB|TB)$/.exec(text.trim());
  if (match === null) return 0;
  const power = { B: 0, kB: 1, KB: 1, MB: 2, GB: 3, TB: 4 }[match[2] as 'B'];
  return Math.round(Number(match[1]) * 1000 ** power);
}

/** Linux's MemAvailable (what can be used without swapping); elsewhere, free memory. */
async function availableMemory(): Promise<number> {
  try {
    const line = /^MemAvailable:\s+(\d+) kB$/m.exec(await readFile('/proc/meminfo', 'utf8'));
    if (line?.[1] !== undefined) return Number(line[1]) * 1024;
  } catch {
    // Not Linux.
  }
  return freemem();
}

interface SystemDf {
  readonly Images?: readonly { readonly Repository: string; readonly Size: string }[];
  readonly Volumes?: readonly { readonly Labels: string; readonly Size: string }[];
}

/** The laptop's own figures, cheap to read (the guard reads them every 30 s). */
export interface SystemFigures {
  readonly memoryTotalBytes: number;
  readonly memoryAvailableBytes: number;
  readonly diskFreeBytes: number;
  readonly load1: number;
  readonly cores: number;
}

/** Memory, free disk where Docker keeps its data, and load. */
export async function readSystem(docker: Docker): Promise<SystemFigures> {
  const root = (await docker(['info', '--format', '{{.DockerRootDir}}'])).stdout || '/';
  const disk = await statfs(root).catch(() => statfs('/'));
  return {
    memoryTotalBytes: totalmem(),
    memoryAvailableBytes: await availableMemory(),
    diskFreeBytes: disk.bavail * disk.bsize,
    load1: loadavg()[0] ?? 0,
    cores: availableParallelism(),
  };
}

/** Flowcanvas's disk: our images and this prefix's volumes. Slow (Docker sizes every volume; about 4 s here). */
export async function readFlowcanvasDisk(
  docker: Docker,
  prefix = 'fc',
): Promise<{ imagesBytes: number; volumesBytes: number }> {
  const df = JSON.parse(
    (await docker(['system', 'df', '--verbose', '--format', '{{json .}}'], { timeoutMs: 120_000 }))
      .stdout,
  ) as SystemDf;
  const sum = (sizes: readonly string[]) =>
    sizes.reduce((total, size) => total + parseDockerSize(size), 0);
  return {
    imagesBytes: sum(
      (df.Images ?? []).filter((i) => i.Repository === 'flowcanvas-workspace').map((i) => i.Size),
    ),
    volumesBytes: sum(
      (df.Volumes ?? [])
        .filter((v) => v.Labels.split(',').includes(`${LABEL.prefix}=${prefix}`))
        .map((v) => v.Size),
    ),
  };
}

export async function readFigures(docker: Docker, prefix = 'fc'): Promise<Figures> {
  const states = (
    await docker([
      'ps',
      '--all',
      '--filter',
      `label=${LABEL.prefix}=${prefix}`,
      '--filter',
      `label=${LABEL.role}=workspace`,
      '--format',
      '{{.State}}',
    ])
  ).stdout.split('\n');
  return {
    ...(await readSystem(docker)),
    running: states.filter((state) => state === 'running').length,
    asleep: states.filter((state) => state === 'paused').length,
    ...(await readFlowcanvasDisk(docker, prefix)),
  };
}

const gib = (bytes: number) => `${(bytes / GiB).toFixed(1)} GiB`;

/** Each figure against its limit. The guard (step 8a) acts when one isn't ok. */
export function assess(figures: Figures): Check[] {
  const flowcanvasDisk = figures.imagesBytes + figures.volumesBytes;
  const maxLoad = BUDGET.maxLoadPerCore * figures.cores;
  return [
    {
      name: 'Workspaces running',
      value: `${String(figures.running)} (and ${String(figures.asleep)} asleep)`,
      limit: `at most ${String(BUDGET.maxRunning)}`,
      ok: figures.running <= BUDGET.maxRunning,
    },
    {
      name: 'Flowcanvas disk (images and workspaces)',
      value: gib(flowcanvasDisk),
      limit: `at most ${gib(BUDGET.flowcanvasDiskBytes)}`,
      ok: flowcanvasDisk <= BUDGET.flowcanvasDiskBytes,
    },
    {
      name: 'Memory available',
      value: `${gib(figures.memoryAvailableBytes)} of ${gib(figures.memoryTotalBytes)}`,
      limit: `at least ${gib(BUDGET.minAvailableMemoryBytes)}`,
      ok: figures.memoryAvailableBytes >= BUDGET.minAvailableMemoryBytes,
    },
    {
      name: 'Disk free',
      value: gib(figures.diskFreeBytes),
      limit: `at least ${gib(BUDGET.minFreeDiskBytes)}`,
      ok: figures.diskFreeBytes >= BUDGET.minFreeDiskBytes,
    },
    {
      name: 'Load (1 minute)',
      value: `${figures.load1.toFixed(2)} on ${String(figures.cores)} cores`,
      limit: `at most ${maxLoad.toFixed(1)}`,
      ok: figures.load1 <= maxLoad,
    },
  ];
}
