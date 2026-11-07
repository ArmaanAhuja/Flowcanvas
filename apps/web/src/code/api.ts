// The project's files through the control plane (phase 3): the list, reads with versions, conflict-safe saves.
// Routes: /api/projects/:id/workspace/{tree,file} (services/control-plane/src/workspaces/file-routes.ts).
import { UNREACHABLE, problemFrom, type ApiProblem } from '../projects/api';

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspace`;
const fileUrl = (projectId: string, path: string) =>
  `${base(projectId)}/file?path=${encodeURIComponent(path)}`;

export interface FileList {
  readonly files: readonly string[];
  readonly truncated: boolean;
}

export async function fetchTree(
  projectId: string,
  fetcher: typeof fetch,
): Promise<FileList | ApiProblem> {
  try {
    const response = await fetcher(`${base(projectId)}/tree`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return await problemFrom(response);
    const body = (await response.json()) as { files?: unknown; truncated?: unknown };
    const files = Array.isArray(body.files)
      ? body.files.filter((path): path is string => typeof path === 'string')
      : [];
    return { files, truncated: body.truncated === true };
  } catch {
    return UNREACHABLE;
  }
}

/** Why a file can't be shown: the workspace's own sentence and its code (`secret_file`, `too_large`…). */
export interface FileRefusal {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
}

export type OpenedFile =
  | { readonly kind: 'text'; readonly content: string; readonly version: string }
  /** Not UTF-8 text (an image, a font): shown as such, never as garbled text. */
  | { readonly kind: 'binary'; readonly size: number }
  | FileRefusal;

export async function readFile(
  projectId: string,
  path: string,
  fetcher: typeof fetch,
): Promise<OpenedFile> {
  try {
    const response = await fetcher(fileUrl(projectId, path), {
      headers: { accept: 'application/json' },
    });
    const body = (await response.json().catch(() => ({}))) as {
      content?: unknown;
      encoding?: unknown;
      version?: unknown;
      size?: unknown;
      error?: unknown;
      code?: unknown;
    };
    if (!response.ok) {
      return {
        kind: 'refused',
        code: typeof body.code === 'string' ? body.code : 'failed',
        message: typeof body.error === 'string' ? body.error : UNREACHABLE.message,
      };
    }
    if (body.encoding === 'base64') {
      return { kind: 'binary', size: typeof body.size === 'number' ? body.size : 0 };
    }
    if (typeof body.content !== 'string' || typeof body.version !== 'string') {
      return {
        kind: 'refused',
        code: 'failed',
        message: 'The workspace sent something unexpected.',
      };
    }
    return { kind: 'text', content: body.content, version: body.version };
  } catch {
    return { kind: 'refused', code: 'unreachable', message: UNREACHABLE.message };
  }
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly version: string }
  /** The file changed in the workspace since this content was opened (the terminal, another tab, an agent). */
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** Writes the file if it's still the version the content was edited from (`null`: a file that doesn't exist). */
export async function saveFile(
  projectId: string,
  path: string,
  content: string,
  baseVersion: string | null,
  fetcher: typeof fetch,
): Promise<SaveResult> {
  try {
    const response = await fetcher(fileUrl(projectId, path), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf8', baseVersion }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      version?: unknown;
      error?: unknown;
      code?: unknown;
    };
    if (response.ok && typeof body.version === 'string')
      return { kind: 'saved', version: body.version };
    const message = typeof body.error === 'string' ? body.error : UNREACHABLE.message;
    return response.status === 409 && body.code === 'conflict'
      ? { kind: 'conflict', message }
      : { kind: 'failed', message };
  } catch {
    return { kind: 'failed', message: UNREACHABLE.message };
  }
}
