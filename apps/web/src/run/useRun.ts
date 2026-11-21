// The project's run state, live (build plan v2, phase 3): loaded once, then each process's card and output over the
// run events WebSocket. The state is asked for again when a process ends (installing changes "installed").
import { useCallback, useEffect, useRef, useState } from 'react';
import { isProblem } from '../projects/api';
import {
  parseProcessEvent,
  runApi,
  runEventsUrl,
  type ProcessView,
  type RunState,
  type StartRequest,
} from './api';

export interface RunControl {
  readonly state: RunState | undefined;
  readonly problem: string | undefined;
  readonly processes: readonly ProcessView[];
  start(request: StartRequest): Promise<ProcessView | undefined>;
  stop(id: string): void;
  restart(id: string): void;
  setVariable(file: string, name: string, value: string): Promise<string | undefined>;
  createEnvFile(file: string): Promise<string | undefined>;
  /** Output so far, then each new chunk, until the returned function is called. */
  follow(id: string, write: (text: string) => void): () => void;
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  /**
   * The Run button: variables the example says are required come first (unless `anyway`), then installing if the
   * dependencies aren't there, then the main script.
   */
  runMain(options?: { readonly anyway?: boolean }): 'needs-variables' | 'started' | 'nothing';
  /** Installing first, before the main script starts. */
  readonly preparing: boolean;
  /** The main script's card while it runs. */
  readonly main: ProcessView | undefined;
}

export function useRun(
  projectId: string,
  enabled: boolean,
  fetcher: typeof fetch,
  openSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
): RunControl {
  const [state, setState] = useState<RunState | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [processes, setProcesses] = useState<readonly ProcessView[]>([]);
  const logs = useRef(new Map<string, string>());
  const followers = useRef(new Map<string, Set<(text: string) => void>>());
  const socket = useRef<WebSocket | undefined>(undefined);
  // The install that Run started, after which it starts the main script.
  const [installThenRun, setInstallThenRun] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    const loaded = await runApi.state(fetcher, projectId);
    if (isProblem(loaded)) {
      setProblem(loaded.message);
      return;
    }
    setProblem(undefined);
    setState(loaded);
    setProcesses(loaded.processes);
  }, [fetcher, projectId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const opened = openSocket(runEventsUrl(projectId));
    socket.current = opened;
    opened.addEventListener('message', (message: MessageEvent) => {
      const event = parseProcessEvent(message.data);
      if (event === undefined) return;
      if (event.type === 'output') {
        logs.current.set(event.id, (logs.current.get(event.id) ?? '') + event.text);
        for (const write of followers.current.get(event.id) ?? []) write(event.text);
        return;
      }
      const view = event.process;
      setProcesses((list) =>
        list.some((p) => p.id === view.id)
          ? list.map((p) => (p.id === view.id ? view : p))
          : [...list, view],
      );
      if (view.state !== 'running' && view.state !== 'stopping') void load();
    });
    return () => {
      socket.current = undefined;
      opened.close();
    };
  }, [enabled, projectId, openSocket, load]);

  const start = useCallback(
    async (request: StartRequest) => {
      const started = await runApi.start(fetcher, projectId, request);
      if (isProblem(started)) {
        setProblem(started.message);
        return undefined;
      }
      setProblem(undefined);
      const view = started.process;
      setProcesses((list) => (list.some((p) => p.id === view.id) ? list : [...list, view]));
      return view;
    },
    [fetcher, projectId],
  );

  // Run's install ended: the main script next if it worked; if it didn't, its card says why.
  const mainScript = state?.plan.main ?? null;
  useEffect(() => {
    if (installThenRun === undefined) return;
    const install = processes.find((p) => p.id === installThenRun);
    if (install === undefined || install.state === 'running' || install.state === 'stopping')
      return;
    setInstallThenRun(undefined);
    if (install.state === 'finished' && mainScript !== null) {
      void start({ kind: 'script', script: mainScript });
    }
  }, [installThenRun, processes, mainScript, start]);

  const send = (message: unknown) => {
    const open = socket.current;
    if (open !== undefined && open.readyState === open.OPEN) open.send(JSON.stringify(message));
  };

  return {
    state,
    problem,
    processes,
    start,
    preparing: installThenRun !== undefined,
    main: processes.find(
      (p) =>
        p.kind === 'script' &&
        p.label === mainScript &&
        (p.state === 'running' || p.state === 'stopping'),
    ),
    runMain: ({ anyway = false } = {}) => {
      if (state === undefined || mainScript === null) return 'nothing';
      if (!anyway && state.plan.missing.some((variable) => variable.required === true)) {
        return 'needs-variables';
      }
      if (!state.plan.installed) {
        void start({ kind: 'install' }).then((install) => {
          if (install !== undefined) setInstallThenRun(install.id);
        });
      } else {
        void start({ kind: 'script', script: mainScript });
      }
      return 'started';
    },
    stop: (id) => {
      void runApi.stop(fetcher, projectId, id);
    },
    restart: (id) => {
      void runApi.restart(fetcher, projectId, id).then((result) => {
        if (isProblem(result)) setProblem(result.message);
      });
    },
    setVariable: async (file, name, value) => {
      const result = await runApi.setVariable(fetcher, projectId, { file, name, value });
      if (isProblem(result)) return result.message;
      setState(result);
      return undefined;
    },
    createEnvFile: async (file) => {
      const result = await runApi.createEnvFile(fetcher, projectId, file);
      if (isProblem(result)) return result.message;
      setState(result);
      return undefined;
    },
    follow: (id, write) => {
      const known = logs.current.get(id);
      let current = true;
      const set = followers.current.get(id) ?? new Set();
      followers.current.set(id, set);
      if (known === undefined) {
        // Started before this page: its output so far, then what follows.
        void runApi.log(fetcher, projectId, id).then((result) => {
          if (!current || isProblem(result)) return;
          logs.current.set(id, result.log + (logs.current.get(id) ?? ''));
          write(result.log);
        });
      } else write(known);
      set.add(write);
      return () => {
        current = false;
        set.delete(write);
      };
    },
    input: (id, data) => {
      send({ type: 'input', id, data });
    },
    resize: (id, cols, rows) => {
      send({ type: 'resize', id, cols, rows });
    },
  };
}
