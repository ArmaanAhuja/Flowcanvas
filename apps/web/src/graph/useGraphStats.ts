// Labs → Graph stats (phase 6): the project's flow graph as the engine last built it, asked for while the switch is on
// and the workspace runs. Often while it's being built; now and then once it's ready, to see rebuilds after edits.
// Asking is never activity (the API says so), so this never keeps a workspace awake.
import type { GraphStatus } from '@flowcanvas/engine/protocol';
import { useEffect, useState } from 'react';
import { UNREACHABLE, problemFrom, type ApiProblem } from '../projects/api';

export const GRAPH_POLL = { buildingMs: 2_000, readyMs: 15_000, retryMs: 5_000 } as const;

export async function fetchGraph(
  projectId: string,
  fetcher: typeof fetch,
): Promise<GraphStatus | ApiProblem> {
  try {
    const response = await fetcher(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/index/graph`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as GraphStatus;
  } catch {
    return UNREACHABLE;
  }
}

export type GraphView =
  | { readonly state: 'loading' | 'unavailable'; readonly message: null; readonly snapshot: null }
  | GraphStatus;

const LOADING: GraphView = { state: 'loading', message: null, snapshot: null };
const UNAVAILABLE: GraphView = { state: 'unavailable', message: null, snapshot: null };

export function useGraphStats(
  projectId: string,
  running: boolean,
  enabled: boolean,
  fetcher: typeof fetch,
): GraphView {
  const [view, setView] = useState<GraphView>(LOADING);

  useEffect(() => {
    if (!enabled) return;
    if (!running) {
      setView(UNAVAILABLE);
      return;
    }
    setView(LOADING);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time: the next only after this one's answer.
    const ask = async () => {
      const result = await fetchGraph(projectId, fetcher);
      if (stopped) return;
      if ('state' in result) {
        setView(result);
        const busy = result.state === 'waiting' || result.state === 'building';
        timer = setTimeout(() => void ask(), busy ? GRAPH_POLL.buildingMs : GRAPH_POLL.readyMs);
      } else {
        setView({ state: 'failed', message: result.message, snapshot: null });
        timer = setTimeout(() => void ask(), GRAPH_POLL.retryMs);
      }
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, running, enabled, fetcher]);

  return view;
}
