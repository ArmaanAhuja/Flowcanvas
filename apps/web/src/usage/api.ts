import { isProblem, problemFrom, UNREACHABLE, type ApiProblem } from '../projects/api';

/** This month's usage, as /api/usage answers it. */
export interface UsageSummary {
  /** ISO 8601, UTC. */
  readonly periodStart: string;
  readonly resetsAt: string;
  readonly workspaceSeconds: number;
  readonly storageByteHours: number;
}

export { isProblem, type ApiProblem };

export async function fetchUsage(fetcher: typeof fetch): Promise<UsageSummary | ApiProblem> {
  try {
    const response = await fetcher('/api/usage', { headers: { accept: 'application/json' } });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { usage: UsageSummary }).usage;
  } catch {
    return UNREACHABLE;
  }
}
