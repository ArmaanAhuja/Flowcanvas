// The Code view's open files (phase 3 step 5): which are open, what each shows, and saving with the version
// it was opened at. The editor's latest state per file is kept in a ref, not React state, so typing doesn't
// re-render the page; React state changes only when what's shown changes (a dot, a status, another file).
import type { EditorState, Text } from '@codemirror/state';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readFile, saveFile, type OpenedFile } from './api';

export type SaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface OpenFile {
  readonly path: string;
  /** What the file shows: loading, text in the editor, a binary file, or the workspace's reason it can't open. */
  readonly view:
    | { readonly kind: 'loading' }
    | { readonly kind: 'text'; readonly initial: EditorState }
    | Exclude<OpenedFile, { kind: 'text' }>;
  readonly unsaved: boolean;
  readonly save: SaveStatus;
}

interface Saved {
  /** The version on disk this file's text was opened or last saved at. */
  version: string;
  /** That text, to tell unsaved changes from an undo back to it. */
  doc: Text;
}

const storageKey = (projectId: string) => `flowcanvas-code-${projectId}`;

interface Remembered {
  readonly open: readonly string[];
  readonly active: string | null;
}

function remembered(projectId: string): Remembered {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(storageKey(projectId)) ?? 'null',
    ) as Partial<Remembered> | null;
    const open = Array.isArray(value?.open)
      ? value.open.filter((path): path is string => typeof path === 'string')
      : [];
    const active =
      typeof value?.active === 'string' && open.includes(value.active)
        ? value.active
        : (open[0] ?? null);
    return { open: open.slice(0, 30), active };
  } catch {
    return { open: [], active: null };
  }
}

export interface CodeFiles {
  readonly files: readonly OpenFile[];
  readonly active: OpenFile | undefined;
  readonly open: (path: string) => void;
  readonly show: (path: string) => void;
  readonly close: (path: string) => void;
  readonly save: (path: string) => Promise<void>;
  /** The editor's latest state for a file (text, selection, undo), e.g. for the status bar. */
  readonly latest: (path: string) => EditorState | undefined;
  /** Every change from the editor of the shown file. */
  readonly updated: (path: string, state: EditorState) => void;
}

export function useCodeFiles(
  projectId: string,
  fetcher: typeof fetch,
  enabled: boolean,
): CodeFiles {
  const [files, setFiles] = useState<readonly OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const latestStates = useRef(new Map<string, EditorState>());
  const saved = useRef(new Map<string, Saved>());
  const saveRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());

  const patch = useCallback((path: string, change: (file: OpenFile) => OpenFile) => {
    setFiles((now) => now.map((file) => (file.path === path ? change(file) : file)));
  }, []);

  const load = useCallback(
    async (path: string) => {
      const opened = await readFile(projectId, path, fetcher);
      if (opened.kind !== 'text') {
        patch(path, (file) => ({ ...file, view: opened }));
        return;
      }
      // CodeMirror loads with the editor, not with the project page (the bundle budget caught it, step 5).
      const { fileState } = await import('./editor-setup');
      const state = await fileState(path, opened.content, {
        save: () => void saveRef.current(path),
      });
      latestStates.current.set(path, state);
      saved.current.set(path, { version: opened.version, doc: state.doc });
      patch(path, (file) => ({ ...file, view: { kind: 'text', initial: state }, unsaved: false }));
    },
    [projectId, fetcher, patch],
  );

  // Paths open or being opened, so two quick opens of one file make one tab (updaters must stay pure).
  const openPaths = useRef(new Set<string>());
  const open = useCallback(
    (path: string) => {
      setActivePath(path);
      if (openPaths.current.has(path)) return;
      openPaths.current.add(path);
      setFiles((now) => [
        ...now,
        { path, view: { kind: 'loading' }, unsaved: false, save: { kind: 'idle' } },
      ]);
      void load(path);
    },
    [load],
  );

  // The tabs open when the page was last here, once the workspace runs.
  const restored = useRef(false);
  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    const { open: paths, active } = remembered(projectId);
    for (const path of paths) open(path);
    if (active !== null) setActivePath(active);
  }, [enabled, projectId, open]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(
        storageKey(projectId),
        JSON.stringify({ open: files.map((file) => file.path), active: activePath }),
      );
    } catch {
      // Not remembering the tabs is fine.
    }
  }, [files, activePath, projectId]);

  const save = useCallback(
    async (path: string) => {
      const state = latestStates.current.get(path);
      const base = saved.current.get(path);
      if (state === undefined || base === undefined) return;
      const doc = state.doc;
      patch(path, (file) => ({ ...file, save: { kind: 'saving' } }));
      const result = await saveFile(projectId, path, doc.toString(), base.version, fetcher);
      if (result.kind === 'saved') {
        saved.current.set(path, { version: result.version, doc });
        // Typing during the save leaves the newer text unsaved.
        const now = latestStates.current.get(path)?.doc ?? doc;
        patch(path, (file) => ({ ...file, unsaved: !now.eq(doc), save: { kind: 'saved' } }));
      } else {
        patch(path, (file) => ({ ...file, save: result }));
      }
    },
    [projectId, fetcher, patch],
  );
  saveRef.current = save;

  const close = useCallback(
    (path: string) => {
      void (async () => {
        const file = files.find((f) => f.path === path);
        // Never lose work: a file with unsaved changes is saved before it closes, and stays open if it can't be.
        if (file?.unsaved === true) {
          await saveRef.current(path);
          const after = latestStates.current.get(path);
          const base = saved.current.get(path);
          if (after === undefined || base === undefined || !after.doc.eq(base.doc)) return;
        }
        latestStates.current.delete(path);
        saved.current.delete(path);
        openPaths.current.delete(path);
        const index = files.findIndex((f) => f.path === path);
        const next = files.filter((f) => f.path !== path);
        setFiles((now) => now.filter((f) => f.path !== path));
        setActivePath((current) =>
          current === path ? (next[Math.min(index, next.length - 1)]?.path ?? null) : current,
        );
      })();
    },
    [files],
  );

  const updated = useCallback((path: string, state: EditorState) => {
    const previous = latestStates.current.get(path);
    latestStates.current.set(path, state);
    if (previous?.doc === state.doc) return;
    const base = saved.current.get(path);
    const unsaved = base !== undefined && !state.doc.eq(base.doc);
    setFiles((now) =>
      now.some((file) => file.path === path && file.unsaved !== unsaved)
        ? now.map((file) =>
            file.path === path
              ? {
                  ...file,
                  unsaved,
                  save: file.save.kind === 'saved' ? { kind: 'idle' } : file.save,
                }
              : file,
          )
        : now,
    );
  }, []);

  const active = useMemo(() => files.find((file) => file.path === activePath), [files, activePath]);

  return {
    files,
    active,
    open,
    show: setActivePath,
    close,
    save,
    latest: (path) => latestStates.current.get(path),
    updated,
  };
}
