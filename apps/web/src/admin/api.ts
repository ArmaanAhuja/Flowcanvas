import { isProblem, problemFrom, UNREACHABLE, type ApiProblem } from '../projects/api';

export type Role = 'member' | 'admin';

/** A person as the admin view shows them: counts only, never what's in their projects. */
export interface Person {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly providers: readonly string[];
  readonly projectCount: number;
  readonly workspaceSecondsThisMonth: number;
  readonly createdAt: string;
  readonly lastSignedInAt: string | null;
  readonly allowed: boolean;
}

export interface AllowedEmail {
  readonly email: string;
  readonly role: Role;
  readonly addedAt: string;
  readonly signedUp: boolean;
}

export interface AdminView {
  readonly people: readonly Person[];
  readonly allowlist: readonly AllowedEmail[];
}

export { isProblem, type ApiProblem };

const entry = (email: string) => `/api/admin/allowlist/${encodeURIComponent(email)}`;

export async function fetchAdminView(fetcher: typeof fetch): Promise<AdminView | ApiProblem> {
  try {
    const response = await fetcher('/api/admin', { headers: { accept: 'application/json' } });
    if (!response.ok) return await problemFrom(response);
    return (await response.json()) as AdminView;
  } catch {
    return UNREACHABLE;
  }
}

/** Adds an email to the allowlist, or changes its role. */
export async function allowEmail(
  fetcher: typeof fetch,
  email: string,
  role: Role,
): Promise<'added' | 'changed' | ApiProblem> {
  try {
    const response = await fetcher(entry(email), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) return await problemFrom(response);
    return ((await response.json()) as { result: 'added' | 'changed' }).result;
  } catch {
    return UNREACHABLE;
  }
}

/** Takes an email off the allowlist; the person is signed out everywhere. */
export async function disallowEmail(
  fetcher: typeof fetch,
  email: string,
): Promise<undefined | ApiProblem> {
  try {
    const response = await fetcher(entry(email), { method: 'DELETE' });
    return response.ok ? undefined : await problemFrom(response);
  } catch {
    return UNREACHABLE;
  }
}
