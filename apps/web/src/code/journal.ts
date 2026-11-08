// The journal of unsaved changes (phase 3 step 6, ADR 0022): kept in two places, so closing the tab, losing the
// network or a stopped workspace never loses an edit.
// - The workspace: /api/projects/:id/workspace/journal (the agent's journal, outside the project).
// - This browser: IndexedDB, for when the workspace can't be reached.
// Entries carry a revision that only rises (a time, never repeated), so the newer of two copies always wins.

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspace`;
const entryUrl = (projectId: string, path: string) =>
  `${base(projectId)}/journal/entry?path=${encodeURIComponent(path)}`;

export interface JournalEntry {
  readonly path: string;
  readonly content: string;
  /** The file's version the content was edited from; null for a file that didn't exist. */
  readonly baseVersion: string | null;
  readonly revision: number;
  /** When it was written (ms since the epoch). */
  readonly updatedAt: number;
}

/** A revision later than `previous` and than any earlier one from this clock: the time, or one more. */
export function nextRevision(previous: number, now: number = Date.now()): number {
  return Math.max(previous + 1, now);
}

/** A keepalive request's body can be at most 64 KiB (the browser's limit for requests that outlive the page). */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export const workspaceJournal = {
  async put(
    projectId: string,
    entry: Omit<JournalEntry, 'updatedAt'>,
    fetcher: typeof fetch,
    keepalive = false,
  ): Promise<boolean> {
    const body = JSON.stringify({
      content: entry.content,
      baseVersion: entry.baseVersion,
      revision: entry.revision,
    });
    try {
      const response = await fetcher(entryUrl(projectId, entry.path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        ...(keepalive && body.length <= KEEPALIVE_MAX_BYTES ? { keepalive: true } : {}),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async get(
    projectId: string,
    path: string,
    fetcher: typeof fetch,
  ): Promise<JournalEntry | undefined> {
    try {
      const response = await fetcher(entryUrl(projectId, path), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as Partial<JournalEntry>;
      return typeof body.content === 'string' &&
        typeof body.revision === 'number' &&
        typeof body.path === 'string'
        ? {
            path: body.path,
            content: body.content,
            baseVersion: typeof body.baseVersion === 'string' ? body.baseVersion : null,
            revision: body.revision,
            updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
          }
        : undefined;
    } catch {
      return undefined;
    }
  },

  /** Paths with unsaved changes in the workspace's journal. */
  async paths(projectId: string, fetcher: typeof fetch): Promise<string[]> {
    try {
      const response = await fetcher(`${base(projectId)}/journal`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { entries?: { path?: unknown }[] };
      return (body.entries ?? [])
        .map((entry) => entry.path)
        .filter((path): path is string => typeof path === 'string');
    } catch {
      return [];
    }
  },

  async drop(
    projectId: string,
    path: string,
    revision: number,
    fetcher: typeof fetch,
  ): Promise<void> {
    try {
      await fetcher(`${entryUrl(projectId, path)}&revision=${String(revision)}`, {
        method: 'DELETE',
      });
    } catch {
      // A leftover entry is harmless: on reopening it matches the file and is discarded.
    }
  },
};

/** The browser's copy. Anything can fail here (private windows, storage turned off): then it does nothing. */
export interface LocalJournal {
  put(projectId: string, entry: JournalEntry): Promise<void>;
  get(projectId: string, path: string): Promise<JournalEntry | undefined>;
  /** Removes the entry if it's no newer than `revision`. */
  drop(projectId: string, path: string, revision: number): Promise<void>;
}

const DB = 'flowcanvas-journal';
const STORE = 'entries';
const key = (projectId: string, path: string) => `${projectId}\u0000${path}`;

function request<T>(
  make: (store: IDBObjectStore) => IDBRequest<T>,
  mode: IDBTransactionMode,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(STORE);
      };
      open.onerror = () => {
        resolve(undefined);
      };
      open.onsuccess = () => {
        const db = open.result;
        try {
          const transaction = db.transaction(STORE, mode);
          const result = make(transaction.objectStore(STORE));
          transaction.oncomplete = () => {
            db.close();
            resolve(result.result);
          };
          transaction.onerror = () => {
            db.close();
            resolve(undefined);
          };
        } catch {
          db.close();
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

export const indexedDbJournal: LocalJournal = {
  async put(projectId, entry) {
    const current = await this.get(projectId, entry.path);
    if (current !== undefined && current.revision > entry.revision) return;
    await request((store) => store.put(entry, key(projectId, entry.path)), 'readwrite');
  },
  async get(projectId, path) {
    const value = (await request((store) => store.get(key(projectId, path)), 'readonly')) as
      JournalEntry | undefined;
    return value !== undefined && typeof value.content === 'string' ? value : undefined;
  },
  async drop(projectId, path, revision) {
    const current = await this.get(projectId, path);
    if (current === undefined || current.revision > revision) return;
    await request((store) => store.delete(key(projectId, path)), 'readwrite');
  },
};

/** For tests: the same contract in memory. */
export function memoryJournal(): LocalJournal & { readonly entries: Map<string, JournalEntry> } {
  const entries = new Map<string, JournalEntry>();
  return {
    entries,
    put(projectId, entry) {
      const current = entries.get(key(projectId, entry.path));
      if (current === undefined || current.revision <= entry.revision)
        entries.set(key(projectId, entry.path), entry);
      return Promise.resolve();
    },
    get(projectId, path) {
      return Promise.resolve(entries.get(key(projectId, path)));
    },
    drop(projectId, path, revision) {
      const current = entries.get(key(projectId, path));
      if (current !== undefined && current.revision <= revision)
        entries.delete(key(projectId, path));
      return Promise.resolve();
    },
  };
}

/** The newer of two copies (by revision), if any. */
export function newest(...entries: (JournalEntry | undefined)[]): JournalEntry | undefined {
  return entries.reduce<JournalEntry | undefined>(
    (best, entry) =>
      entry !== undefined && (best === undefined || entry.revision > best.revision) ? entry : best,
    undefined,
  );
}
