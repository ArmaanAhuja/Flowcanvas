// The desktop app's Run (build plan v2, phase 3): the button's sequence (variables, install, the main script), the
// prompt for missing variables, and the process cards, against a stand-in local server.
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  looksSecret,
  parseProcessEvent,
  randomSecret,
  type ProcessView,
  type RunState,
} from './api';
import { RunButton } from './RunButton';
import { RUN_TEXT, RunPanel } from './RunPanel';
import { useRun } from './useRun';

afterEach(cleanup);

const plan = (change: Partial<RunState['plan']> = {}): RunState => ({
  plan: {
    packageManager: 'pnpm',
    node: { wanted: '24', have: 'v24.1.0', fits: true },
    installed: true,
    scripts: [
      { name: 'dev', command: 'next dev' },
      { name: 'build', command: 'next build' },
    ],
    main: 'dev',
    compose: 'docker-compose.dev.yml',
    envFiles: [{ example: 'apps/web/.env.sample', file: 'apps/web/.env', exists: true }],
    missing: [],
    ...change,
  },
  docker: true,
  processes: [],
});

const view = (change: Partial<ProcessView>): ProcessView => ({
  id: 'p1',
  kind: 'script',
  label: 'dev',
  command: 'pnpm run dev',
  state: 'running',
  exitCode: null,
  ports: [],
  problem: null,
  startedAt: '2026-11-22T00:00:00.000Z',
  endedAt: null,
  ...change,
});

/** A stand-in for the local server's run routes and its events socket. */
function server(initial: RunState) {
  let state = initial;
  let next = 0;
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const sockets: FakeSocket[] = [];
  const fetcher = vi.fn<typeof fetch>((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/run/start')) {
      next += 1;
      const request = body as { kind: string; script?: string };
      const started = view({
        id: `p${String(next)}`,
        kind: request.kind as ProcessView['kind'],
        label: request.kind === 'install' ? 'Install dependencies' : (request.script ?? ''),
      });
      return Promise.resolve(Response.json({ process: started }));
    }
    if (url.endsWith('/run/env')) {
      const { name } = body as { name: string };
      state = {
        ...state,
        plan: { ...state.plan, missing: state.plan.missing.filter((m) => m.name !== name) },
      };
      return Promise.resolve(Response.json(state));
    }
    if (url.endsWith('/run/env-file')) {
      state = {
        ...state,
        plan: { ...state.plan, envFiles: state.plan.envFiles.map((f) => ({ ...f, exists: true })) },
      };
      return Promise.resolve(Response.json(state));
    }
    if (url.endsWith('/log')) return Promise.resolve(Response.json({ log: '' }));
    return Promise.resolve(Response.json(state));
  });
  const open = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  return {
    fetcher,
    open,
    calls,
    sockets,
    set: (change: Partial<RunState>) => {
      state = { ...state, ...change };
    },
  };
}

class FakeSocket extends EventTarget {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(event: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

const starts = (calls: { url: string; body?: unknown }[]) =>
  calls.filter((c) => c.url.endsWith('/run/start')).map((c) => c.body);

describe('Run', () => {
  it('installs first when the dependencies aren’t there, then runs the main script once that worked', async () => {
    const api = server(plan({ installed: false }));
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    expect(api.sockets[0]?.url).toBe('ws://localhost:3000/api/projects/p-1/workspace/run/events');
    act(() => {
      expect(result.current.runMain()).toBe('started');
    });
    await waitFor(() => {
      expect(starts(api.calls)).toEqual([{ kind: 'install' }]);
    });
    await waitFor(() => {
      expect(result.current.preparing).toBe(true);
    });
    api.set({ plan: { ...plan().plan, installed: true } });
    act(() => {
      api.sockets[0]?.emit({
        type: 'process',
        process: view({
          id: 'p1',
          kind: 'install',
          label: 'Install dependencies',
          state: 'finished',
          exitCode: 0,
        }),
      });
    });
    await waitFor(() => {
      expect(starts(api.calls)).toEqual([{ kind: 'install' }, { kind: 'script', script: 'dev' }]);
    });
    expect(result.current.preparing).toBe(false);
  });

  it('doesn’t run the main script after an install that failed', async () => {
    const api = server(plan({ installed: false }));
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    act(() => {
      result.current.runMain();
    });
    await waitFor(() => {
      expect(result.current.preparing).toBe(true);
    });
    act(() => {
      api.sockets[0]?.emit({
        type: 'process',
        process: view({
          id: 'p1',
          kind: 'install',
          label: 'Install dependencies',
          state: 'failed',
          exitCode: 1,
        }),
      });
    });
    await waitFor(() => {
      expect(result.current.preparing).toBe(false);
    });
    expect(starts(api.calls)).toEqual([{ kind: 'install' }]);
  });

  it('asks for the variables the example says are required before it runs, unless run anyway', async () => {
    const missing = [
      {
        name: 'SECRET_PASSWORD',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: true,
      },
      {
        name: 'SMTP_USER',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: null,
      },
    ];
    const api = server(plan({ missing }));
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    act(() => {
      expect(result.current.runMain()).toBe('needs-variables');
    });
    expect(starts(api.calls)).toEqual([]);
    act(() => {
      expect(result.current.runMain({ anyway: true })).toBe('started');
    });
    await waitFor(() => {
      expect(starts(api.calls)).toEqual([{ kind: 'script', script: 'dev' }]);
    });
  });

  it('shows Stop and the address while the main script runs', async () => {
    const api = server(plan());
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    act(() => {
      api.sockets[0]?.emit({ type: 'process', process: view({ ports: [3000] }) });
    });
    render(<RunButton run={result.current} onNeedsPanel={() => undefined} />);
    expect(screen.getByRole('link', { name: 'localhost:3000' }).getAttribute('href')).toBe(
      'http://localhost:3000',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/processes/p1/stop'))).toBe(true);
    });
  });
});

describe('RunPanel', () => {
  it('prompts for a missing required variable, saves it to the project’s .env, and never shows the value', async () => {
    const missing = [
      {
        name: 'SECRET_PASSWORD',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: true,
      },
      {
        name: 'SMTP_USER',
        listedIn: 'apps/web/.env.sample',
        file: 'apps/web/.env',
        required: null,
      },
    ];
    const api = server(plan({ missing }));
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    const onRun = vi.fn();
    const { rerender } = render(<RunPanel run={result.current} onRun={onRun} />);
    expect(screen.getByRole('group', { name: RUN_TEXT.needed })).toBeTruthy();
    expect(screen.getByText(RUN_TEXT.others(1))).toBeTruthy();
    expect(screen.getByText(RUN_TEXT.saved('apps/web/.env'))).toBeTruthy();
    const field = screen.getByLabelText('SECRET_PASSWORD');
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.type(field, 'hunter2-secret');
    await userEvent.click(
      within(screen.getByRole('group', { name: RUN_TEXT.needed })).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() => {
      expect(api.calls.find((c) => c.url.endsWith('/run/env'))?.body).toEqual({
        file: 'apps/web/.env',
        name: 'SECRET_PASSWORD',
        value: 'hunter2-secret',
      });
    });
    rerender(<RunPanel run={result.current} onRun={onRun} />);
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: RUN_TEXT.needed })).toBeNull();
    });
    expect(document.body.textContent).not.toContain('hunter2-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Run dev' }));
    expect(onRun).toHaveBeenCalled();
  });

  it('offers to start a .env from its example, and says what the project needs first', async () => {
    const api = server(
      plan({
        installed: false,
        node: { wanted: '24', have: 'v26.13.0', fits: false },
        envFiles: [{ example: '.env.example', file: '.env', exists: false }],
      }),
    );
    api.set({ docker: false });
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.state).toBeDefined();
    });
    const { rerender } = render(<RunPanel run={result.current} onRun={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toBe(RUN_TEXT.node('24', 'v26.13.0'));
    expect(screen.getByText(RUN_TEXT.notInstalled)).toBeTruthy();
    expect(screen.getByText(RUN_TEXT.noDocker)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: RUN_TEXT.services }).disabled,
    ).toBe(true);
    await userEvent.click(
      screen.getByRole('button', { name: RUN_TEXT.create('.env', '.env.example') }),
    );
    await waitFor(() => {
      expect(api.calls.find((c) => c.url.endsWith('/run/env-file'))?.body).toEqual({
        file: '.env',
      });
    });
    rerender(<RunPanel run={result.current} onRun={() => undefined} />);
    await waitFor(() => {
      expect(screen.queryByText(RUN_TEXT.noFile('.env'))).toBeNull();
    });
  });

  it('shows a card per process, newest first, with Stop while it runs', async () => {
    const api = server({
      ...plan(),
      processes: [
        view({
          id: 'p1',
          kind: 'install',
          label: 'Install dependencies',
          command: 'pnpm install',
          state: 'finished',
          exitCode: 0,
        }),
        view({ id: 'p2', ports: [3000] }),
      ],
    });
    const { result } = renderHook(() => useRun('p-1', true, api.fetcher, api.open));
    await waitFor(() => {
      expect(result.current.processes).toHaveLength(2);
    });
    render(<RunPanel run={result.current} onRun={() => undefined} />);
    const cards = screen.getAllByRole('region');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'dev',
      'Install dependencies',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/processes/p2/stop'))).toBe(true);
    });
  });
});

describe('run api', () => {
  it('reads only well-formed events, and offers Generate for secrets only', () => {
    expect(parseProcessEvent('{"type":"output","id":"p1","text":"hi"}')).toEqual({
      type: 'output',
      id: 'p1',
      text: 'hi',
    });
    expect(parseProcessEvent('{"type":"process"}')).toBeUndefined();
    expect(parseProcessEvent('nope')).toBeUndefined();
    expect(looksSecret('SECRET_PASSWORD')).toBe(true);
    expect(looksSecret('NEXT_PRIVATE_ENCRYPTION_KEY')).toBe(true);
    expect(looksSecret('DATABASE_URL')).toBe(false);
    expect(looksSecret('GOOGLE_CLIENT_ID')).toBe(false);
    expect(randomSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
