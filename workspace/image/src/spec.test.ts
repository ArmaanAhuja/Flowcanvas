import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOCKERFILE_URL,
  WORKSPACE_LIMITS,
  egressNetworkCreateArgs,
  egressRunArgs,
  imageTag,
  networkCreateArgs,
  runArgs,
} from './spec.js';

const dockerfile = readFileSync(DOCKERFILE_URL, 'utf8');
const root = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const image = imageTag();
const ID = '0b6f8a52-3c1d-4e7f-9a2b-5c6d7e8f9a0b';
const base = {
  name: 'fc-ws-1',
  prefix: 'fc',
  workspaceId: ID,
  network: 'fc-net-1',
  volume: 'fc-vol-1',
  egress: 'fc-egress',
  image,
};

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
    const args = networkCreateArgs('fc-net-1', 'fc');
    expect(args.slice(0, 3)).toEqual(['network', 'create', '--internal']);
    expect(values(args, '--opt')).toEqual(['com.docker.network.bridge.gateway_mode_ipv4=isolated']);
    expect(args.at(-1)).toBe('fc-net-1');
    expect(values(args, '--label')).toEqual([
      'org.flowcanvas.workspace=1',
      'org.flowcanvas.prefix=fc',
      'org.flowcanvas.role=workspace',
    ]);
  });

  it('gives the egress proxy an ordinary bridge with no traffic between its members', () => {
    const args = egressNetworkCreateArgs('fc-egress-out', 'fc');
    expect(args).not.toContain('--internal');
    expect(values(args, '--opt')).toEqual(['com.docker.network.bridge.enable_icc=false']);
    expect(values(args, '--label')).toContain('org.flowcanvas.role=egress');
  });

  it('refuses names that could be read as flags or are not ours', () => {
    for (const name of ['--driver=host', '-x', '', 'Has-Caps', 'a b', 'a/b', 'x'.repeat(64)]) {
      expect(() => networkCreateArgs(name, 'fc')).toThrow(/Invalid network name/);
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

  it('labels it as ours, with its workspace, for clean-up and the resource guard', () => {
    expect(values(args, '--label')).toEqual([
      'org.flowcanvas.workspace=1',
      'org.flowcanvas.prefix=fc',
      'org.flowcanvas.role=workspace',
      `org.flowcanvas.workspace-id=${ID}`,
    ]);
  });

  it('sends HTTPS through the egress proxy, and never waits for a git password', () => {
    expect(values(args, '--env')).toEqual([
      'HTTPS_PROXY=http://fc-egress:3128',
      'https_proxy=http://fc-egress:3128',
      'GIT_TERMINAL_PROMPT=0',
    ]);
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
    expect(() => runArgs({ ...base, workspaceId: '../x' })).toThrow(/Invalid workspace ID/);
    expect(() => runArgs({ ...base, egress: 'evil.example:80' })).toThrow(/Invalid egress name/);
    expect(() => runArgs({ ...base, prefix: '--rm' })).toThrow(/Invalid prefix name/);
  });
});

describe('egressRunArgs', () => {
  const egress = {
    name: 'fc-egress',
    prefix: 'fc',
    network: 'fc-egress-out',
    image,
    script: '/repo/workspace/host/src/egress/proxy.ts',
    version: 'a1b2c3d4e5f6',
  };
  const args = egressRunArgs(egress);

  it('is locked down like a workspace, and smaller', () => {
    expect(values(args, '--user')).toEqual(['1000:1000']);
    expect(values(args, '--cap-drop')).toEqual(['ALL']);
    expect(values(args, '--security-opt')).toEqual(['no-new-privileges']);
    expect(args).toContain('--read-only');
    expect(values(args, '--memory')).toEqual([String(256 * 1024 ** 2)]);
    expect(values(args, '--pids-limit')).toEqual(['64']);
  });

  it('never forwards packets between the networks it is attached to', () => {
    expect(values(args, '--sysctl')).toEqual([
      'net.ipv4.ip_forward=0',
      'net.ipv6.conf.all.forwarding=0',
    ]);
  });

  it('mounts only the proxy script, read-only, and runs it', () => {
    expect(values(args, '--volume')).toEqual([`${egress.script}:/opt/egress/proxy.ts:ro`]);
    expect(args.slice(-3)).toEqual([image, 'node', '/opt/egress/proxy.ts']);
    expect(values(args, '--label')).toContain('org.flowcanvas.egress-version=a1b2c3d4e5f6');
  });

  it('refuses a relative or mount-breaking script path', () => {
    for (const script of ['proxy.ts', '/a:/b', '/a,ro', '/a\nb']) {
      expect(() => egressRunArgs({ ...egress, script })).toThrow(/Invalid script path/);
    }
  });
});
