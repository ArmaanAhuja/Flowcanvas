import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectRunPlan, packageManagerOf } from './detect.js';
import {
  createEnvFile,
  parseEnvEntries,
  parseEnvNames,
  parseEnvSet,
  parseExample,
  setEnvValue,
} from './env.js';
import { nodeFits } from './node-version.js';
import { childEnvironment, portsIn, Processes, stripAnsi, type ProcessView } from './processes.js';
import { MASK, RUN_MESSAGES, RunService, envTargets } from './service.js';

let root: string;
const write = (path: string, text: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-run-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Waits for the process to end (or `state`), as the page would see it; real programs, so up to 15 s under load. */
async function until(processes: Processes, id: string, done: (view: ProcessView) => boolean) {
  for (let i = 0; i < 600; i += 1) {
    const view = processes.get(id);
    if (view !== undefined && done(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process ${id} never got there: ${JSON.stringify(processes.get(id))}`);
}

describe('env files', () => {
  it('reads names, values and which are set, as dotenv does', () => {
    const text = [
      '# comment',
      'DATABASE_URL=postgres://localhost/db',
      'export SECRET_PASSWORD="a b # c"',
      "SINGLE='x'",
      'EMPTY=',
      'QUOTED_EMPTY=""',
      'WITH_COMMENT=value # note',
      'not a line',
    ].join('\n');
    expect(parseEnvNames(text)).toEqual([
      'DATABASE_URL',
      'SECRET_PASSWORD',
      'SINGLE',
      'EMPTY',
      'QUOTED_EMPTY',
      'WITH_COMMENT',
    ]);
    expect(parseEnvSet(text)).toEqual([
      'DATABASE_URL',
      'SECRET_PASSWORD',
      'SINGLE',
      'WITH_COMMENT',
    ]);
    expect(Object.fromEntries(parseEnvEntries(text))).toMatchObject({
      SECRET_PASSWORD: 'a b # c',
      WITH_COMMENT: 'value',
    });
  });

  it('sets a value in place or at the end, keeps the rest, and makes a new file private', () => {
    const file = join(root, '.env');
    setEnvValue(file, 'API_KEY', 'abc 123');
    expect(readFileSync(file, 'utf8')).toBe('API_KEY="abc 123"\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileSync(file, '# mine\nA=1\nB=2');
    setEnvValue(file, 'A', 'changed');
    setEnvValue(file, 'C', 'new');
    expect(readFileSync(file, 'utf8')).toBe('# mine\nA=changed\nB=2\nC=new\n');
    expect(parseEnvEntries(readFileSync(file, 'utf8'))).toContainEqual(['A', 'changed']);
  });

  it('reads whether an example’s comment says a variable is required or optional', () => {
    const text = [
      '# A secret key used to encrypt user sessions (required, at least 32 characters)',
      '# Generate a random secret key using: openssl rand -hex 32',
      'SECRET_PASSWORD=',
      '',
      '# Object Storage (S3) (optional)',
      'S3_BUCKET_NAME=rallly',
      'S3_REGION=garage',
      '',
      'PORT=3000',
      '# OPTIONAL: The passphrase',
      'PASSPHRASE=',
      '# NOT_A_VARIABLE=commented-out',
    ].join('\n');
    expect(parseExample(text)).toEqual([
      { name: 'SECRET_PASSWORD', required: true },
      { name: 'S3_BUCKET_NAME', required: false },
      { name: 'S3_REGION', required: false },
      { name: 'PORT', required: null },
      { name: 'PASSPHRASE', required: false },
    ]);
  });

  it('starts a .env from its example, private, and never over one that’s there', () => {
    writeFileSync(join(root, '.env.example'), 'A=default\n');
    createEnvFile(join(root, '.env.example'), join(root, '.env'));
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('A=default\n');
    expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
    expect(() => {
      createEnvFile(join(root, '.env.example'), join(root, '.env'));
    }).toThrow();
  });

  it('refuses a name that isn’t one, and a value that spans lines', () => {
    const file = join(root, '.env');
    expect(() => {
      setEnvValue(file, 'A=B', 'x');
    }).toThrow('variable name');
    expect(() => {
      setEnvValue(file, 'A', 'x\nB=injected');
    }).toThrow('span lines');
  });
});

describe('detectRunPlan', () => {
  it('finds the package manager from packageManager, else the lockfile', () => {
    write('package.json', '{"packageManager":"pnpm@10.28.0"}');
    expect(packageManagerOf(root)).toBe('pnpm');
    write('package.json', '{}');
    expect(packageManagerOf(root)).toBe('npm');
    write('yarn.lock', '');
    expect(packageManagerOf(root)).toBe('yarn');
  });

  it('puts dev first as the Run button, prefers a development compose file, and lists unset variables', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { build: 'next build', dev: 'next dev', lint: 'x' } }),
    );
    write(
      'apps/web/.env.sample',
      'DATABASE_URL=\nSECRET_PASSWORD=\nNEXT_PUBLIC_URL=http://localhost:3000\n',
    );
    write('apps/web/.env', 'DATABASE_URL=postgres://x\n');
    write('.env.example', 'ROOT_ONLY=\n');
    const files = [
      'package.json',
      'apps/web/.env.sample',
      '.env.example',
      'docker-compose.yml',
      'docker-compose.dev.yml',
    ];
    const plan = detectRunPlan(root, files, { SET_IN_SHELL: 'yes' });
    expect(plan.main).toBe('dev');
    expect(plan.scripts.map((s) => s.name)).toEqual(['dev', 'build', 'lint']);
    expect(plan.compose).toBe('docker-compose.dev.yml');
    expect(plan.installed).toBe(false);
    expect(plan.missing).toEqual([
      { name: 'ROOT_ONLY', listedIn: '.env.example', file: '.env', required: null },
      {
        name: 'SECRET_PASSWORD',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: null,
      },
      {
        name: 'NEXT_PUBLIC_URL',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: null,
      },
    ]);
    expect(plan.envFiles).toEqual([
      { example: '.env.example', file: '.env', exists: false },
      { example: 'apps/web/.env.sample', file: 'apps/web/.env', exists: true },
    ]);
    expect(plan.node).toBeNull();
    // Set in the shell that started the app counts as set.
    expect(detectRunPlan(root, files, { ROOT_ONLY: 'x' }).missing.map((m) => m.name)).not.toContain(
      'ROOT_ONLY',
    );
  });

  it('finds Documenso’s compose file under docker/development, and no Run button without dev or start', () => {
    write('package.json', JSON.stringify({ scripts: { build: 'x' } }));
    const plan = detectRunPlan(root, [
      'docker/production/compose.yml',
      'docker/development/compose.yml',
      'docker/testing/compose.yml',
    ]);
    expect(plan.compose).toBe('docker/development/compose.yml');
    expect(plan.main).toBeNull();
  });
});

describe('nodeFits', () => {
  it('understands the common engines.node forms, and says when it can’t tell', () => {
    expect(nodeFits('24', 'v24.22.3')).toBe(true);
    expect(nodeFits('24', 'v26.13.0')).toBe(false);
    expect(nodeFits('24.x', 'v24.1.0')).toBe(true);
    expect(nodeFits('>=20.9.0', 'v26.13.0')).toBe(true);
    expect(nodeFits('>=20.9.0', 'v20.8.1')).toBe(false);
    expect(nodeFits('^20 || ^22', 'v22.3.0')).toBe(true);
    expect(nodeFits('^20 || ^22', 'v24.0.0')).toBe(false);
    expect(nodeFits('>=18 <23', 'v22.9.0')).toBe(true);
    expect(nodeFits('>= 18 < 23', 'v23.0.0')).toBe(false);
    expect(nodeFits('~22.3', 'v22.3.9')).toBe(true);
    expect(nodeFits('~22.3', 'v22.4.0')).toBe(false);
    expect(nodeFits('lts/*', 'v24.0.0')).toBeNull();
  });

  it('puts the project’s Node next to the person’s in the plan', () => {
    write('package.json', JSON.stringify({ engines: { node: '24' } }));
    expect(detectRunPlan(root, [], {}, 'v26.13.0').node).toEqual({
      wanted: '24',
      have: 'v26.13.0',
      fits: false,
    });
    expect(detectRunPlan(root, [], {}, null).node).toEqual({
      wanted: '24',
      have: null,
      fits: false,
    });
  });
});

// Real processes (npm takes seconds to start when every package's tests run at once): more than the default 5 s.
describe('Processes', { timeout: 20_000 }, () => {
  it('runs a command, keeps its log, finds its port, and says it finished', async () => {
    const processes = new Processes();
    const events: string[] = [];
    processes.onEvent((event) => events.push(event.type));
    const view = processes.start({
      kind: 'script',
      label: 'dev',
      file: 'sh',
      args: ['-c', 'printf "\\033[32mready\\033[0m on http://localhost:3123\\n"; echo oops >&2'],
      cwd: root,
    });
    expect(view.command).toBe(
      'sh -c printf "\\033[32mready\\033[0m on http://localhost:3123\\n"; echo oops >&2',
    );
    const ended = await until(processes, view.id, (v) => v.state === 'finished');
    expect(ended).toMatchObject({ exitCode: 0, ports: [3123] });
    const log = processes.log(view.id) ?? '';
    expect(stripAnsi(log)).toContain('ready on http://localhost:3123');
    expect(log).toContain('oops');
    // Colours are kept for the card's terminal view.
    expect(log).toContain('\u001b[32m');
    expect(events).toContain('output');
  });

  it('stops a process and everything it started', async () => {
    const processes = new Processes();
    // The child starts a grandchild that writes its pid, then both wait.
    const view = processes.start({
      kind: 'script',
      label: 'dev',
      file: 'sh',
      args: ['-c', 'sleep 30 & echo $! > child.pid; echo started; wait'],
      cwd: root,
    });
    await until(processes, view.id, () => processes.log(view.id)?.includes('started') === true);
    const grandchild = Number(readFileSync(join(root, 'child.pid'), 'utf8'));
    processes.stop(view.id);
    const ended = await until(processes, view.id, (v) => v.state === 'stopped');
    expect(ended.exitCode).toBeNull();
    // Gone within moments (the group got the signal), however busy the machine is.
    await expect
      .poll(
        () => {
          try {
            process.kill(grandchild, 0);
            return 'alive';
          } catch {
            return 'gone';
          }
        },
        { timeout: 5000 },
      )
      .toBe('gone');
  });

  it('says clearly when the program isn’t installed, and fails on a non-zero exit', async () => {
    const processes = new Processes();
    const missing = processes.start({
      kind: 'install',
      label: 'Install dependencies',
      file: 'no-such-package-manager',
      args: ['install'],
      cwd: root,
    });
    const failed = await until(processes, missing.id, (v) => v.state === 'failed');
    expect(failed.problem).toContain('no-such-package-manager isn’t installed');
    const exit = processes.start({
      kind: 'script',
      label: 'x',
      file: 'sh',
      args: ['-c', 'exit 3'],
      cwd: root,
    });
    expect(await until(processes, exit.id, (v) => v.state === 'failed')).toMatchObject({
      exitCode: 3,
    });
  });

  it('doesn’t start the same thing twice while it runs, and restarts as a new card', async () => {
    const processes = new Processes();
    const options = {
      kind: 'script',
      label: 'dev',
      file: 'sleep',
      args: ['30'],
      cwd: root,
    } as const;
    const first = processes.start(options);
    expect(processes.start(options).id).toBe(first.id);
    const second = await processes.restart(first.id);
    expect(second?.id).not.toBe(first.id);
    expect(processes.get(first.id)?.state).toBe('stopped');
    await processes.stopAll();
    expect(processes.get(second?.id ?? '')?.state).toBe('stopped');
  });

  it('shows a prompt that doesn’t end its line, and takes the answer typed into the card', async () => {
    const processes = new Processes();
    const view = processes.start({
      kind: 'script',
      label: 'asks',
      file: 'sh',
      args: ['-c', 'printf "Use another port? "; read -r answer; echo "answered $answer"'],
      cwd: root,
    });
    await until(
      processes,
      view.id,
      () => processes.log(view.id)?.includes('Use another port?') === true,
    );
    expect(processes.input(view.id, 'yes\r')).toBe(true);
    await until(processes, view.id, (v) => v.state === 'finished');
    expect(stripAnsi(processes.log(view.id) ?? '')).toContain('answered yes');
    expect(processes.input(view.id, 'late\r')).toBe(false);
  });

  it('finds the addresses servers print, and keeps our own variables from the project', () => {
    expect(
      portsIn('- Local: http://localhost:3000\n listening on 0.0.0.0:8080, [::]:9229'),
    ).toEqual([3000, 8080, 9229]);
    expect(portsIn('version 1.2:3456')).toEqual([]);
    expect(
      Object.keys(
        childEnvironment({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', FLOWCANVAS_DATA_DIR: '/x' }),
      ),
    ).toEqual(['PATH']);
  });
});

describe('RunService', { timeout: 20_000 }, () => {
  const files = ['package.json', 'apps/web/.env.example', 'docker-compose.dev.yml'];
  const service = (docker = true) =>
    new RunService({
      files: () => Promise.resolve(files),
      onPath: () => docker,
      nodeVersion: () => 'v24.0.0',
    });

  beforeEach(() => {
    write(
      'package.json',
      JSON.stringify({ scripts: { dev: 'echo token=canary-secret-value-123 on localhost:4321' } }),
    );
    write('package-lock.json', '{}');
    write('apps/web/.env.example', 'API_TOKEN=\n');
    write('apps/web/.env', 'API_TOKEN=canary-secret-value-123\n');
  });

  it('starts only the project’s own scripts, and hides its .env values in the log', async () => {
    const run = service();
    await expect(run.start(root, { kind: 'script', script: 'rm -rf /' })).rejects.toThrow(
      RUN_MESSAGES.noScript,
    );
    const view = await run.start(root, { kind: 'script', script: 'dev' });
    expect(view.command).toBe('npm run dev');
    const ended = await until(run.processes(root), view.id, (v) => v.state === 'finished');
    expect(ended.ports).toEqual([4321]);
    const log = run.log(root, view.id);
    expect(log).toContain(`token=${MASK}`);
    expect(log).not.toContain('canary-secret-value-123');
  });

  it('starts and stops the services from the development compose file, with Docker', async () => {
    const spawned: string[] = [];
    const run = new RunService({
      files: () => Promise.resolve(files),
      onPath: () => true,
      nodeVersion: () => null,
      spawn: (file, args) => {
        spawned.push([file, ...args].join(' '));
        throw new Error('not here');
      },
    });
    expect((await run.start(root, { kind: 'services' })).label).toBe('Start services');
    expect((await run.start(root, { kind: 'services-stop' })).label).toBe('Stop services');
    expect(spawned).toEqual([
      'docker compose -f docker-compose.dev.yml up -d',
      'docker compose -f docker-compose.dev.yml stop',
    ]);
  });

  it('starts services only with a compose file and Docker, and says which is missing', async () => {
    await expect(service(false).start(root, { kind: 'services' })).rejects.toThrow(
      RUN_MESSAGES.noDocker,
    );
    const noCompose = new RunService({ files: () => Promise.resolve([]), onPath: () => true });
    await expect(noCompose.start(root, { kind: 'services' })).rejects.toThrow(
      RUN_MESSAGES.noCompose,
    );
  });

  it('writes a value only into a .env beside an example', async () => {
    expect(envTargets(files)).toEqual(['apps/web/.env']);
    const run = service();
    await expect(run.setVariable(root, 'package.json', 'A', 'x')).rejects.toThrow(
      RUN_MESSAGES.notAnEnvFile,
    );
    await expect(run.setVariable(root, '../.env', 'A', 'x')).rejects.toThrow(
      RUN_MESSAGES.notAnEnvFile,
    );
    await run.setVariable(root, 'apps/web/.env', 'NEW_ONE', 'value');
    expect(readFileSync(join(root, 'apps/web/.env'), 'utf8')).toContain('NEW_ONE=value');
    expect((await run.state(root)).plan.missing).toEqual([]);
  });

  it('creates a .env from the example beside it, only where there’s none', async () => {
    rmSync(join(root, 'apps/web/.env'));
    const run = service();
    await expect(run.createEnvFile(root, '.env')).rejects.toThrow(RUN_MESSAGES.notAnEnvFile);
    await run.createEnvFile(root, 'apps/web/.env');
    expect(readFileSync(join(root, 'apps/web/.env'), 'utf8')).toBe('API_TOKEN=\n');
    await expect(run.createEnvFile(root, 'apps/web/.env')).rejects.toThrow(RUN_MESSAGES.envExists);
  });
});
