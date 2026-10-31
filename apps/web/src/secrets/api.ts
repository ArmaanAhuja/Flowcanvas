import { isProblem, problemFrom, UNREACHABLE, type ApiProblem } from '../projects/api';

/** A secret as the API shows it: never its value. */
export interface SecretInfo {
  readonly name: string;
  readonly addedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export { isProblem, type ApiProblem };

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/secrets`;

export async function fetchSecrets(
  fetcher: typeof fetch,
  projectId: string,
): Promise<SecretInfo[] | ApiProblem> {
  try {
    const response = await fetcher(base(projectId), { headers: { accept: 'application/json' } });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { secrets: SecretInfo[] }).secrets;
  } catch {
    return UNREACHABLE;
  }
}

/** Saves or replaces a value. The answer never contains it, and neither does anything this returns. */
export async function saveSecret(
  fetcher: typeof fetch,
  projectId: string,
  name: string,
  value: string,
): Promise<'created' | 'replaced' | ApiProblem> {
  try {
    const response = await fetcher(`${base(projectId)}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { result: 'created' | 'replaced' }).result;
  } catch {
    return UNREACHABLE;
  }
}

export async function removeSecret(
  fetcher: typeof fetch,
  projectId: string,
  name: string,
): Promise<true | ApiProblem> {
  try {
    const response = await fetcher(`${base(projectId)}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    return response.ok ? true : await problemFrom(response);
  } catch {
    return UNREACHABLE;
  }
}
