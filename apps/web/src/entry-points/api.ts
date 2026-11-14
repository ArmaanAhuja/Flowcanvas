// Entry points through the control plane (phase 8, ADR 0030 §5): /index/entry-points, a kind (or a screen's elements)
// a page at a time. The control plane has already checked the engine's answers; here they're read as they are.
import type { EntryPointsResult } from '@flowcanvas/engine/protocol';
import { UNREACHABLE, problemFrom, type ApiProblem } from '../projects/api';

export type EntryKind = EntryPointsResult['kind'];

export async function fetchEntryPoints(
  projectId: string,
  ask: {
    readonly kind: EntryKind;
    readonly after: number;
    readonly limit: number;
    readonly screen?: string;
  },
  fetcher: typeof fetch,
): Promise<EntryPointsResult | ApiProblem> {
  const query = new URLSearchParams({
    kind: ask.kind,
    after: String(ask.after),
    limit: String(ask.limit),
    ...(ask.screen === undefined ? {} : { screen: ask.screen }),
  });
  try {
    const response = await fetcher(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/index/entry-points?${query.toString()}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as EntryPointsResult;
  } catch {
    return UNREACHABLE;
  }
}
