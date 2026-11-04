import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCKERFILE_URL, WORKSPACE_LIMITS, imageTag, networkCreateArgs, runArgs } from './spec.js';

const dockerfile = readFileSync(DOCKERFILE_URL, 'utf8');
const root = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const image = imageTag();
const base = { name: 'fc-ws-1', network: 'fc-net-1', volume: 'fc-vol-1', image };

/** Every value given for `flag`, e.g. all `--security-opt` values. */
function values(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ''] : []));
}

describe('imageTag', () => {
  it('is a short hash of the Dockerfile', () => {
    expect(image).toMatch(/^flowcanvas-workspace:[0-9a-f]{12}$/);
    expect(imageTag(dockerfile)).toBe(image);
  });

  it('changes whenever the Dockerfile changes', () => {
    expect(imageTag(`${dockerfile}\n# changed`)).not.toBe(image);
  });
});

describe('Dockerfile', () => {
  it('pins the base image by digest, on the Node major in .nvmrc', () => {
    const node = root('.nvmrc').trim();
    expect(dockerfile).toMatch(new RegExp(`^FROM node:${node}-slim@sha256:[0-9a-f]{64}$`, 'm'));
  });

  it("installs the repository's pnpm version without install scripts", () => {
    const pnpm = /"packageManager": "pnpm@([^"]+)"/.exec(root('package.json'))?.[1];
    expect(pnpm).toBeDefined();
    expect(dockerfile).toContain(`npm install --global --ignore-scripts pnpm@${String(pnpm)}`);
  });

  it('runs as the unprivileged node user with its home in the workspace volume', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^ENV HOME=\/workspace\/\.home$/m);
  });

  it('turns telemetry off', () => {
    expect(dockerfile).toContain('DO_NOT_TRACK=1');
    expect(dockerfile).toContain('NEXT_TELEMETRY_DISABLED=1');
  });
});

describe('networkCreateArgs', () => {
  it('creates an internal network with no host address on it', () => {
    const args = networkCreateArgs('fc-net-1');
    expect(args.slice(0, 3)).toEqual(['network', 'create', '--internal']);
    expect(values(args, '--opt')).toEqual(['com.docker.network.bridge.gateway_mode_ipv4=isolated']);
    expect(args.at(-1)).toBe('fc-net-1');
  });

  it('refuses names that could be read as flags or are not ours', () => {
    for (const name of ['--driver=host', '-x', '', 'Has-Caps', 'a b', 'a/b', 'x'.repeat(64)]) {
      expect(() => networkCreateArgs(name)).toThrow(/Invalid network name/);
    }
  });
});

describe('runArgs', () => {
  const args = runArgs(base);

  it('drops every privilege containers allow us to drop', () => {
    expect(values(args, '--user')).toEqual(['1000:1000']);
    expect(values(args, '--cap-drop')).toEqual(['ALL']);
    expect(values(args, '--cap-add')).toEqual([]);
    expect(values(args, '--security-opt')).toEqual(['no-new-privileges']);
    expect(args).toContain('--read-only');
    expect(args).toContain('--init');
  });

  it('never weakens isolation or exposes the host', () => {
    for (const flag of [
      '--privileged',
      '--publish',
      '-p',
      '--pid',
      '--ipc',
      '--uts',
      '--userns',
      '--device',
    ]) {
      expect(args).not.toContain(flag);
    }
    const joined = args.join(' ');
    for (const text of ['privileged', 'unconfined', 'docker.sock', '=host'])
      expect(joined).not.toContain(text);
    expect(values(args, '--network')).toEqual(['fc-net-1']);
    // The only mounts: the workspace volume, and a size-capped /tmp.
    expect(values(args, '--volume')).toEqual(['fc-vol-1:/workspace']);
    expect(values(args, '--mount')).toEqual([]);
    expect(values(args, '--tmpfs')).toEqual([
      `/tmp:rw,nosuid,nodev,size=${String(WORKSPACE_LIMITS.tmpBytes)}`,
    ]);
  });

  it('applies the default limits, with no swap on top of memory', () => {
    expect(values(args, '--cpus')).toEqual(['2']);
    expect(values(args, '--memory')).toEqual([String(4 * 1024 ** 3)]);
    expect(values(args, '--memory-swap')).toEqual(values(args, '--memory'));
    expect(values(args, '--pids-limit')).toEqual(['1024']);
  });

  it('keeps no container logs and never restarts on its own', () => {
    expect(values(args, '--log-driver')).toEqual(['none']);
    expect(values(args, '--restart')).toEqual(['no']);
  });

  it('takes limit overrides', () => {
    const small = runArgs({ ...base, limits: { memoryBytes: 64 * 1024 ** 2, pids: 32 } });
    expect(values(small, '--memory')).toEqual([String(64 * 1024 ** 2)]);
    expect(values(small, '--pids-limit')).toEqual(['32']);
    expect(values(small, '--cpus')).toEqual(['2']);
  });

  it('puts the image last, so nothing after it is read as a flag', () => {
    expect(args.at(-1)).toBe(image);
    expect(args[0]).toBe('run');
  });

  it('refuses bad names, limits and images', () => {
    expect(() => runArgs({ ...base, name: '--privileged' })).toThrow(/Invalid container name/);
    expect(() => runArgs({ ...base, volume: '/:/host' })).toThrow(/Invalid volume name/);
    expect(() => runArgs({ ...base, network: 'host network' })).toThrow(/Invalid network name/);
    for (const pids of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runArgs({ ...base, limits: { pids } })).toThrow(/Invalid limit pids/);
    }
    expect(() => runArgs({ ...base, image: 'ubuntu:latest' })).toThrow(/Invalid image/);
    expect(() => runArgs({ ...base, image: `${image} --privileged` })).toThrow(/Invalid image/);
  });
});
