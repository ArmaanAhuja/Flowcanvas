// The project index through the control plane (phase 4, ADR 0025): its status and symbol search.
// Routes: /api/projects/:id/workspace/index/{status,search} (services/control-plane/src/workspaces/index-routes.ts).
// The control plane has already checked the engine's answers; here they're only read defensively.
import type { EngineStatus, SymbolHit } from '@flowcanvas/engine/protocol';
import { UNREACHABLE, problemFrom, type ApiProblem } from '../projects/api';

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/workspace/index`;

export type IndexStatus = EngineStatus;
export type SymbolResult = SymbolHit;

export async function fetchIndexStatus(
  projectId: string,
  fetcher: typeof fetch,
): Promise<IndexStatus | ApiProblem> {
  try {
    const response = await fetcher(`${base(projectId)}/status`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as IndexStatus;
  } catch {
    return UNREACHABLE;
  }
}

export interface SymbolSearch {
  readonly symbols: readonly SymbolResult[];
}

/** Symbols matching `query`, best first. `signal` cancels a search the person has typed past. */
export async function searchSymbols(
  projectId: string,
  query: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<SymbolSearch | ApiProblem> {
  try {
    const response = await fetcher(
      `${base(projectId)}/search?q=${encodeURIComponent(query)}&limit=50`,
      { headers: { accept: 'application/json' }, ...(signal === undefined ? {} : { signal }) },
    );
    if (!response.ok) return await problemFrom(response);
    const body = (await response.json()) as { symbols?: unknown };
    return { symbols: Array.isArray(body.symbols) ? (body.symbols as SymbolResult[]) : [] };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return UNREACHABLE;
  }
}
