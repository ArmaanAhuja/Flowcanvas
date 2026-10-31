import type { Database } from '../db/database.js';

/** The states a workspace record can be in (0001_initial.sql); only `not_created` until phase 1d. */
export type WorkspaceState =
  'not_created' | 'creating' | 'running' | 'sleeping' | 'resuming' | 'stopped' | 'failed';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  /** The project's one cloud workspace, as the control plane last recorded it. */
  readonly workspace: { readonly id: string; readonly state: WorkspaceState };
}

export interface NewProject {
  readonly name: string;
  readonly repoUrl: string | null;
}

/** A rejected field, with a sentence the page can show next to it. */
export interface FieldProblem {
  readonly field: 'name' | 'repoUrl';
  readonly message: string;
}

export const NAME_MAX = 100;
const REPO_URL_MAX = 500;
// Control characters (newlines, tabs, NUL…) make names that look identical but aren't, and break logs.
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Checks a create request's body. The database enforces the same name rules (0001_initial.sql) as a backstop. */
export function parseNewProject(body: unknown): NewProject | FieldProblem {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (name === '') return { field: 'name', message: 'Give the project a name.' };
  // Code points, exactly what Postgres's char_length() checks (0001_initial.sql), so both limits agree.
  if (Array.from(name).length > NAME_MAX) {
    return { field: 'name', message: `Keep the name to ${String(NAME_MAX)} characters or fewer.` };
  }
  if (CONTROL_CHARACTERS.test(name)) {
    return { field: 'name', message: 'Use letters, numbers, spaces and punctuation only.' };
  }

  const rawUrl = typeof fields.repoUrl === 'string' ? fields.repoUrl.trim() : '';
  if (rawUrl === '') return { name, repoUrl: null };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      field: 'repoUrl',
      message: 'Enter a full address, like https://github.com/owner/repo.',
    };
  }
  if (url.protocol !== 'https:' || url.hostname === '') {
    return { field: 'repoUrl', message: 'Use an https:// address.' };
  }
  // A token in the URL would be stored and shown in plain text. Private repositories connect another way later.
  if (url.username !== '' || url.password !== '') {
    return {
      field: 'repoUrl',
      message: 'Remove the username or token from the address. Never put credentials in a URL.',
    };
  }
  if (rawUrl.length > REPO_URL_MAX) {
    return { field: 'repoUrl', message: 'That address is too long.' };
  }
  return { name, repoUrl: url.toString() };
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly repo_url: string | null;
  readonly created_ms: number;
  readonly workspace_id: string;
  readonly workspace_state: WorkspaceState;
}

const columns = (p: string) =>
  `${p}.id, ${p}.name, ${p}.repo_url, (extract(epoch from ${p}.created_at) * 1000)::float8 as created_ms`;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repo_url,
    createdAt: new Date(row.created_ms).toISOString(),
    workspace: { id: row.workspace_id, state: row.workspace_state },
  };
}

/** The person's own projects, newest first. Nobody sees anyone else's. */
export async function listProjects(db: Database, ownerId: string): Promise<Project[]> {
  const rows = await db.query<ProjectRow>(
    `select ${columns('p')}, w.id as workspace_id, w.state as workspace_state
     from projects p join workspaces w on w.project_id = p.id
     where p.owner_id = $1 order by p.created_at desc, p.name`,
    [ownerId],
  );
  return rows.map(toProject);
}

/** Creates a project and its workspace record together, or says the person already has one with that name. */
export async function createProject(
  db: Database,
  ownerId: string,
  project: NewProject,
): Promise<Project | 'duplicate-name'> {
  // One statement, so there's never a project without its workspace (Neon's HTTP driver has no
  // multi-call transactions). `on conflict do nothing` turns a duplicate name into "no row".
  const rows = await db.query<ProjectRow>(
    `with p as (
       insert into projects (owner_id, name, repo_url) values ($1, $2, $3)
       on conflict (owner_id, name) do nothing
       returning *
     ), w as (
       insert into workspaces (project_id) select id from p returning id, state
     )
     select ${columns('p')}, w.id as workspace_id, w.state as workspace_state from p, w`,
    [ownerId, project.name, project.repoUrl],
  );
  const row = rows[0];
  return row === undefined ? 'duplicate-name' : toProject(row);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this project exists and belongs to this person. Anything else, including a malformed ID, is "no". */
export async function ownsProject(
  db: Database,
  projectId: string,
  ownerId: string,
): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const rows = await db.query('select 1 from projects where id = $1 and owner_id = $2', [
    projectId,
    ownerId,
  ]);
  return rows.length > 0;
}
