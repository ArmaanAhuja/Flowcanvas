/** A workspace's state as the control plane records it (phase 1d). */
export type WorkspaceState =
  'not_created' | 'creating' | 'running' | 'sleeping' | 'resuming' | 'stopped' | 'failed';

export interface Workspace {
  readonly id: string;
  readonly state: WorkspaceState;
  /** ISO 8601, UTC. */
  readonly stateChangedAt: string;
  /** Why it isn't as asked: a failed start, or the resource guard's change. Null otherwise. */
  readonly failure: string | null;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string | null;
  /** The commit it's pinned to (the demo project), or null for the default branch's head. */
  readonly repoCommit: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly workspace: Workspace;
}

export interface ProjectList {
  readonly projects: Project[];
  /** False where workspaces can't run (staging, until a cloud provider is connected). */
  readonly workspacesAvailable: boolean;
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

export async function fetchProjects(fetcher: typeof fetch): Promise<ProjectList | ApiProblem> {
  try {
    const response = await fetcher('/api/projects', { headers: { accept: 'application/json' } });
    if (!response.ok) return await problemFrom(response);
    const body = (await response.json()) as Partial<ProjectList>;
    return {
      projects: body.projects ?? [],
      workspacesAvailable: body.workspacesAvailable === true,
    };
  } catch {
    return UNREACHABLE;
  }
}

export type WorkspaceAction = 'open' | 'sleep' | 'resume' | 'stop';

/** What an action left: the workspace as it is now, and the API's sentence if it didn't go as asked. */
export interface ActionResult {
  readonly workspace?: Workspace;
  readonly problem?: string;
}

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export async function workspaceAction(
  fetcher: typeof fetch,
  projectId: string,
  action: WorkspaceAction,
): Promise<ActionResult> {
  try {
    const response = await fetcher(`${projectPath(projectId)}/workspace/${action}`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const body = (await response.json().catch(() => ({}))) as {
      workspace?: Workspace;
      error?: unknown;
    };
    const problem = response.ok
      ? undefined
      : typeof body.error === 'string'
        ? body.error
        : UNREACHABLE.message;
    return {
      ...(body.workspace === undefined ? {} : { workspace: body.workspace }),
      ...(problem === undefined ? {} : { problem }),
    };
  } catch {
    return { problem: UNREACHABLE.message };
  }
}

export async function fetchWorkspace(
  fetcher: typeof fetch,
  projectId: string,
): Promise<Workspace | ApiProblem> {
  try {
    const response = await fetcher(`${projectPath(projectId)}/workspace`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { workspace: Workspace }).workspace;
  } catch {
    return UNREACHABLE;
  }
}

/** "Open demo project": the stage's demo, made the first time (it isn't opened yet). */
export async function fetchDemoProject(fetcher: typeof fetch): Promise<Project | ApiProblem> {
  try {
    const response = await fetcher('/api/projects/demo', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { project: Project }).project;
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
