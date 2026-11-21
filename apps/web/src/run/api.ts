// Running the project in the desktop app (build plan v2, phase 3): its run plan, its processes and its variables,
// from the local server's /workspace/run routes. Variable values go to the server once, to be written into the
// project's .env; nothing here keeps or shows one.
import { problemFrom, UNREACHABLE, type ApiProblem } from '../projects/api';

export type ProcessState = 'running' | 'stopping' | 'stopped' | 'finished' | 'failed';

export interface ProcessView {
  readonly id: string;
  readonly kind: 'script' | 'install' | 'services';
  readonly label: string;
  readonly command: string;
  readonly state: ProcessState;
  readonly exitCode: number | null;
  readonly ports: readonly number[];
  readonly problem: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface MissingVariable {
  readonly name: string;
  readonly listedIn: string;
  readonly file: string;
  readonly required: boolean | null;
}

export interface RunState {
  readonly plan: {
    readonly packageManager: 'pnpm' | 'yarn' | 'bun' | 'npm';
    readonly node: {
      readonly wanted: string;
      readonly have: string | null;
      readonly fits: boolean | null;
    } | null;
    readonly installed: boolean;
    readonly scripts: readonly { readonly name: string; readonly command: string }[];
    readonly main: string | null;
    readonly compose: string | null;
    readonly envFiles: readonly {
      readonly example: string;
      readonly file: string;
      readonly exists: boolean;
    }[];
    readonly missing: readonly MissingVariable[];
  };
  readonly docker: boolean;
  readonly processes: readonly ProcessView[];
}

export type StartRequest =
  | { readonly kind: 'script'; readonly script: string }
  | { readonly kind: 'install' }
  | { readonly kind: 'services' }
  | { readonly kind: 'services-stop' };

export type ProcessEvent =
  | { readonly type: 'process'; readonly process: ProcessView }
  | { readonly type: 'output'; readonly id: string; readonly text: string };

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspace/run`;

async function call<T>(
  fetcher: typeof fetch,
  url: string,
  init?: { method: string; body?: unknown },
): Promise<T | ApiProblem> {
  try {
    const response = await fetcher(url, {
      method: init?.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as T;
  } catch {
    return UNREACHABLE;
  }
}

export const runApi = {
  state: (fetcher: typeof fetch, projectId: string) => call<RunState>(fetcher, base(projectId)),
  start: (fetcher: typeof fetch, projectId: string, request: StartRequest) =>
    call<{ process: ProcessView }>(fetcher, `${base(projectId)}/start`, {
      method: 'POST',
      body: request,
    }),
  stop: (fetcher: typeof fetch, projectId: string, id: string) =>
    call<{ process: ProcessView }>(fetcher, `${base(projectId)}/processes/${id}/stop`, {
      method: 'POST',
      body: {},
    }),
  restart: (fetcher: typeof fetch, projectId: string, id: string) =>
    call<{ process: ProcessView }>(fetcher, `${base(projectId)}/processes/${id}/restart`, {
      method: 'POST',
      body: {},
    }),
  log: (fetcher: typeof fetch, projectId: string, id: string) =>
    call<{ log: string }>(fetcher, `${base(projectId)}/processes/${id}/log`),
  setVariable: (
    fetcher: typeof fetch,
    projectId: string,
    variable: { file: string; name: string; value: string },
  ) => call<RunState>(fetcher, `${base(projectId)}/env`, { method: 'PUT', body: variable }),
  createEnvFile: (fetcher: typeof fetch, projectId: string, file: string) =>
    call<RunState>(fetcher, `${base(projectId)}/env-file`, { method: 'POST', body: { file } }),
};

export function runEventsUrl(projectId: string, where: Location = window.location): string {
  return `${where.protocol === 'https:' ? 'wss' : 'ws'}://${where.host}${base(projectId)}/events`;
}

export function parseProcessEvent(text: unknown): ProcessEvent | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const event = JSON.parse(text) as Record<string, unknown>;
    if (event.type === 'output' && typeof event.id === 'string' && typeof event.text === 'string') {
      return { type: 'output', id: event.id, text: event.text };
    }
    const process = event.process as Partial<ProcessView> | undefined;
    if (
      event.type === 'process' &&
      typeof process?.id === 'string' &&
      typeof process.label === 'string' &&
      typeof process.state === 'string'
    ) {
      return { type: 'process', process: process as ProcessView };
    }
  } catch {
    // Not an event.
  }
  return undefined;
}

/** Whether a variable's name says it holds a secret, so "Generate" is offered for it. */
export function looksSecret(name: string): boolean {
  return (
    /SECRET|PASSWORD|KEY|TOKEN|PASSPHRASE|SALT/i.test(name) && !/URL|HOST|PORT|ID$/i.test(name)
  );
}

/** 32 random bytes as hex, as `openssl rand -hex 32` gives. */
export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
