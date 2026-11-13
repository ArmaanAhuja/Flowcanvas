// Flows and node details through the control plane (phase 7, ADR 0028): /index/flow and /index/details, with a
// place in the project. The control plane has already checked the engine's answers; here they're read as they are.
import type { CodePosition, DetailsResult, FlowResult } from '@flowcanvas/engine/protocol';
import { UNREACHABLE, problemFrom, type ApiProblem } from '../projects/api';

const ask = async <T>(
  projectId: string,
  op: 'flow' | 'details',
  at: CodePosition,
  fetcher: typeof fetch,
): Promise<T | ApiProblem> => {
  const query = new URLSearchParams({
    path: at.path,
    line: String(at.line),
    column: String(at.column),
  });
  try {
    const response = await fetcher(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/index/${op}?${query.toString()}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as T;
  } catch {
    return UNREACHABLE;
  }
};

export const fetchFlow = (projectId: string, at: CodePosition, fetcher: typeof fetch) =>
  ask<FlowResult>(projectId, 'flow', at, fetcher);

export const fetchDetails = (projectId: string, at: CodePosition, fetcher: typeof fetch) =>
  ask<DetailsResult>(projectId, 'details', at, fetcher);
