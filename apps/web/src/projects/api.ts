/** A workspace's state as the control plane records it; only `not_created` until phase 1d. */
export type WorkspaceState =
  'not_created' | 'creating' | 'running' | 'sleeping' | 'resuming' | 'stopped' | 'failed';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly workspace: { readonly id: string; readonly state: WorkspaceState };
}

/**
 * Form fields the API can name in an error: a project's name and address, a secret's name and value, an
 * allowlist email.
 */
export type ApiField = 'name' | 'repoUrl' | 'value' | 'email';
const FIELDS: readonly unknown[] = ['name', 'repoUrl', 'value', 'email'];

/** What the page can show: the API's own sentence, and which field it's about when it names one. */
export interface ApiProblem {
  readonly message: string;
  readonly field?: ApiField;
}

export const UNREACHABLE: ApiProblem = {
  message: 'Couldn’t reach Flowcanvas. Check your connection and try again.',
};

export async function problemFrom(response: Response): Promise<ApiProblem> {
  try {
    const body = (await response.json()) as { error?: unknown; field?: unknown };
    const message = typeof body.error === 'string' ? body.error : UNREACHABLE.message;
    return FIELDS.includes(body.field) ? { message, field: body.field as ApiField } : { message };
  } catch {
    return UNREACHABLE;
  }
}

export async function fetchProjects(fetcher: typeof fetch): Promise<Project[] | ApiProblem> {
  try {
    const response = await fetcher('/api/projects', { headers: { accept: 'application/json' } });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { projects: Project[] }).projects;
  } catch {
    return UNREACHABLE;
  }
}

export async function createProject(
  fetcher: typeof fetch,
  project: { readonly name: string; readonly repoUrl: string },
): Promise<Project | ApiProblem> {
  try {
    const response = await fetcher('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(project),
    });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { project: Project }).project;
  } catch {
    return UNREACHABLE;
  }
}

export function isProblem(value: unknown): value is ApiProblem {
  return typeof value === 'object' && value !== null && 'message' in value;
}
