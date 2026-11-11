// The Code view's open files (phase 3, steps 5 and 6): which are open, what each shows, saving with the version
// it was opened at, autosave, and the journal that keeps unsaved changes safe (ADR 0022).
//
// - The editor's latest state per file is in a ref, not React state, so typing doesn't re-render the page.
// - Unsaved changes go to the journal (the workspace and this browser) every couple of seconds and when the page
//   is hidden; reopening a file restores the newest copy if it differs from the file on disk.
// - Autosave (owner, 7 Nov 2026) writes the file after a pause in typing, and when you switch file, view or
//   window. A file in conflict is never autosaved.
// - Changes in the workspace (step 7: the terminal, another tab) reach open files: one without unsaved changes
//   follows the disk; one with them says so and waits for "Keep mine" or "Load the workspace's version".
import type { EditorState, Text } from '@codemirror/state';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readFile, saveFile, type OpenedFile } from './api';
import { versionOf, type DiskEvent } from './events';
import {
  indexedDbJournal,
  newest,
  nextRevision,
  workspaceJournal,
  type JournalEntry,
  type LocalJournal,
} from './journal';

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
  /** Unsaved changes brought back from the journal when the file opened: when they were made. */
  readonly restored?: { readonly at: number };
  /** Deleted in the workspace while open (the terminal, another tab, an agent). */
  readonly deleted?: boolean;
}

export const CONFLICT_ON_RESTORE =
  'This file changed in the workspace since these unsaved changes were made. They’re here, not saved.';
export const CHANGED_ON_DISK =
  'This file changed in the workspace while you were editing it. Your changes are still here, not saved.';

/** How long autosave waits after the last keystroke, and how often unsaved changes go to the journal. */
export interface Timings {
  readonly autosaveMs: number;
  readonly journalMs: number;
}
export const TIMINGS: Timings = { autosaveMs: 5000, journalMs: 2000 };

/** The browser's copy is written this soon after an edit (it's local and cheap), so a tab closed right after
 * typing still has it, even if the browser cuts the close-time writes short. */
const LOCAL_COPY_MS = 300;

interface Saved {
  /** The version a save is checked against: the file's version on disk, or an older one for a stale restore. */
  version: string | null;
  /** The text on disk, to tell unsaved changes from an undo back to it. */
  doc: Text;
}

const storageKey = (projectId: string) => `flowcanvas-code-${projectId}`;
const AUTOSAVE_KEY = 'flowcanvas-autosave';

function remembered(projectId: string): { open: string[]; active: string | null } {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? 'null') as {
      open?: unknown;
      active?: unknown;
    } | null;
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

function rememberedAutosave(): boolean {
  try {
    return window.localStorage.getItem(AUTOSAVE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** A place to show in a file once it's open (a symbol from ⌘K, phase 4): 1-based, columns in UTF-16 units. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** The latest request to show a place; `id` tells a repeated jump to the same place from the last one. */
export interface Reveal extends Position {
  readonly path: string;
  readonly id: number;
}

export interface CodeFiles {
  readonly files: readonly OpenFile[];
  readonly active: OpenFile | undefined;
  /** Opens a file (or shows it if open); with `at`, the editor moves there once the file is shown. */
  readonly open: (path: string, at?: Position) => void;
  /** The latest place asked for, for the editor of that file. */
  readonly reveal: Reveal | undefined;
  readonly show: (path: string) => void;
  readonly close: (path: string) => void;
  readonly save: (path: string) => Promise<void>;
  /** The editor's latest state for a file (text, selection, undo), e.g. for the status bar. */
  readonly latest: (path: string) => EditorState | undefined;
  /** Every change from the editor of the shown file. */
  readonly updated: (path: string, state: EditorState) => void;
  /** Leaving the files (another view): autosave them, or journal them with autosave off. */
  readonly flush: () => void;
  readonly autosave: boolean;
  readonly setAutosave: (on: boolean) => void;
  /** A change in the workspace (events.ts): open files follow it, or say so if they have unsaved changes. */
  readonly onDiskEvent: (event: DiskEvent) => void;
  /** Resolving a conflict: write my text over the workspace's version, knowingly. */
  readonly keepMine: (path: string) => Promise<void>;
  /** Resolving a conflict: drop my changes and show the workspace's version. */
  readonly loadDisk: (path: string) => Promise<void>;
  /** Closing without saving (a file deleted in the workspace whose changes the person chose to drop). */
  readonly discard: (path: string) => void;
}

export interface CodeFilesOptions {
  readonly timings?: Timings;
  /** The browser's journal; IndexedDB by default. */
  readonly local?: LocalJournal;
}

export function useCodeFiles(
  projectId: string,
  fetcher: typeof fetch,
  enabled: boolean,
  options: CodeFilesOptions = {},
): CodeFiles {
  const timings = options.timings ?? TIMINGS;
  const local = options.local ?? indexedDbJournal;
  const [files, setFiles] = useState<readonly OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [autosave, setAutosaveState] = useState(rememberedAutosave);
  const autosaveOn = useRef(autosave);
  autosaveOn.current = autosave;
  const filesRef = useRef(files);
  filesRef.current = files;
  const activeRef = useRef(activePath);
  activeRef.current = activePath;

  const latestStates = useRef(new Map<string, EditorState>());
  const saved = useRef(new Map<string, Saved>());
  /** The revision of each file's latest text, and the last one sent to the journal. */
  const revisions = useRef(new Map<string, number>());
  const journaled = useRef(new Map<string, number>());
  const journalTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const localTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const autosaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());

  const patch = useCallback((path: string, change: (file: OpenFile) => OpenFile) => {
    setFiles((now) => now.map((file) => (file.path === path ? change(file) : file)));
  }, []);

  const isUnsaved = (path: string) => {
    const state = latestStates.current.get(path);
    const base = saved.current.get(path);
    return state !== undefined && base !== undefined && !state.doc.eq(base.doc);
  };

  /** In conflict with the workspace, or deleted there: never autosaved (a save would overwrite or recreate it). */
  const inConflict = (path: string) => {
    const file = filesRef.current.find((f) => f.path === path);
    return file?.save.kind === 'conflict' || file?.deleted === true;
  };
  /** Versions our own saves are writing: their change events are echoes, not someone else's edit. */
  const ownVersions = useRef(new Map<string, Set<string>>());
  /** Files that changed in the workspace while a save of them was on its way, and recheck() for after it. */
  const recheckAfterSave = useRef(new Set<string>());
  const recheckRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());

  /** Sends the file's unsaved text to both journals, unless that revision is there already. */
  const journalNow = useCallback(
    async (path: string, keepalive = false) => {
      const timer = journalTimers.current.get(path);
      if (timer !== undefined) clearTimeout(timer);
      journalTimers.current.delete(path);
      const state = latestStates.current.get(path);
      const base = saved.current.get(path);
      const revision = revisions.current.get(path) ?? 0;
      if (state === undefined || base === undefined || state.doc.eq(base.doc)) return;
      if (journaled.current.get(path) === revision) return;
      journaled.current.set(path, revision);
      const entry: JournalEntry = {
        path,
        // sliceDoc keeps the file's own line breaks; doc.toString() would always write \n.
        content: state.sliceDoc(),
        baseVersion: base.version,
        revision,
        updatedAt: Date.now(),
      };
      await Promise.all([
        workspaceJournal.put(projectId, entry, fetcher, keepalive),
        local.put(projectId, entry).catch(() => undefined),
      ]);
    },
    [projectId, fetcher, local],
  );

  const dropJournal = useCallback(
    (path: string, revision: number) => {
      void workspaceJournal.drop(projectId, path, revision, fetcher);
      void local.drop(projectId, path, revision).catch(() => undefined);
    },
    [projectId, fetcher, local],
  );

  const load = useCallback(
    async (path: string) => {
      const [opened, fromWorkspace, fromBrowser] = await Promise.all([
        readFile(projectId, path, fetcher),
        workspaceJournal.get(projectId, path, fetcher),
        local.get(projectId, path).catch(() => undefined),
      ]);
      if (opened.kind !== 'text') {
        patch(path, (file) => ({ ...file, view: opened }));
        return;
      }
      // CodeMirror loads with the editor, not with the project page (the bundle budget caught it, step 5).
      const { docOf, fileState } = await import('./editor-setup');
      const disk = docOf(opened.content);
      const entry = newest(fromWorkspace, fromBrowser);
      const restore = entry !== undefined && !docOf(entry.content).eq(disk) ? entry : undefined;
      if (entry !== undefined && restore === undefined) dropJournal(path, entry.revision);
      // A restore whose base isn't the file on disk any more must not overwrite it: its save is checked against
      // that older base, so the workspace refuses it instead (a conflict, shown at once).
      const stale = restore !== undefined && restore.baseVersion !== opened.version;
      const state = await fileState(
        path,
        restore?.content ?? opened.content,
        { save: () => void saveRef.current(path) },
        opened.content,
      );
      latestStates.current.set(path, state);
      saved.current.set(path, {
        version: stale ? (restore.baseVersion ?? null) : opened.version,
        doc: disk,
      });
      revisions.current.set(path, restore?.revision ?? 0);
      if (restore !== undefined) journaled.current.set(path, restore.revision);
      patch(path, (file) => ({
        ...file,
        view: { kind: 'text', initial: state },
        unsaved: restore !== undefined,
        save: stale ? { kind: 'conflict', message: CONFLICT_ON_RESTORE } : file.save,
        ...(restore === undefined ? {} : { restored: { at: restore.updatedAt } }),
      }));
    },
    [projectId, fetcher, local, patch, dropJournal],
  );

  // Paths open or being opened, so two quick opens of one file make one tab (updaters must stay pure).
  const openPaths = useRef(new Set<string>());
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);
  const revealCount = useRef(0);

  const open = useCallback(
    (path: string, at?: Position) => {
      if (at !== undefined) {
        revealCount.current += 1;
        setReveal({ path, line: at.line, column: at.column, id: revealCount.current });
      }
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

  // Once the workspace runs: the tabs open when the page was last here, and any file with unsaved changes in the
  // workspace's journal (from another tab or computer), so nothing unsaved is out of sight.
  const restoredTabs = useRef(false);
  useEffect(() => {
    if (!enabled || restoredTabs.current) return;
    restoredTabs.current = true;
    const { open: paths, active } = remembered(projectId);
    for (const path of paths) open(path);
    if (active !== null) setActivePath(active);
    void workspaceJournal.paths(projectId, fetcher).then((unsaved) => {
      for (const path of unsaved) if (!openPaths.current.has(path)) open(path);
      if (active === null && unsaved[0] !== undefined) setActivePath(unsaved[0]);
    });
  }, [enabled, projectId, fetcher, open]);

  useEffect(() => {
    if (!restoredTabs.current) return;
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
      const timer = autosaveTimers.current.get(path);
      if (timer !== undefined) clearTimeout(timer);
      autosaveTimers.current.delete(path);
      const doc = state.doc;
      const revision = revisions.current.get(path) ?? 0;
      patch(path, (file) => ({ ...file, save: { kind: 'saving' } }));
      const content = state.sliceDoc();
      // Known before the save is sent: its change event can arrive before its answer.
      const expected = await versionOf(content);
      const mine = ownVersions.current.get(path) ?? new Set<string>();
      mine.add(expected);
      ownVersions.current.set(path, mine);
      const result = await saveFile(projectId, path, content, base.version, fetcher);
      if (result.kind === 'saved') {
        saved.current.set(path, { version: result.version, doc });
        // The journal's copies up to this text are written now; newer edits (typed during the save) stay.
        dropJournal(path, revision);
        const now = latestStates.current.get(path)?.doc ?? doc;
        // Saved: whatever was restored is written now, so the note goes.
        patch(path, (file) => ({
          path: file.path,
          view: file.view,
          unsaved: !now.eq(doc),
          save: { kind: 'saved' },
        }));
      } else {
        patch(path, (file) => ({ ...file, save: result }));
      }
      // Someone else's change that arrived while this save was on its way: checked now that the save's result is
      // known, so its answer can't hide it.
      if (recheckAfterSave.current.delete(path)) void recheckRef.current(path);
    },
    [projectId, fetcher, patch, dropJournal],
  );
  saveRef.current = save;

  /** Autosave now (when it's on and the file isn't in conflict), else journal it. */
  const settle = useCallback(
    (path: string) => {
      if (!isUnsaved(path)) return;
      if (autosaveOn.current && !inConflict(path)) void saveRef.current(path);
      else void journalNow(path);
    },
    [journalNow],
  );

  const flush = useCallback(() => {
    for (const file of filesRef.current) settle(file.path);
  }, [settle]);

  const show = useCallback(
    (path: string) => {
      // Switching file: the one being left is autosaved (owner, 7 Nov 2026).
      const leaving = activeRef.current;
      if (leaving !== null && leaving !== path) settle(leaving);
      setActivePath(path);
    },
    [settle],
  );

  /** Takes a tab away: its timers (all three), its state, and the next tab shown if it was the shown one. */
  const removeTab = useCallback((path: string) => {
    for (const timers of [journalTimers.current, autosaveTimers.current, localTimers.current]) {
      const timer = timers.get(path);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(path);
    }
    latestStates.current.delete(path);
    saved.current.delete(path);
    openPaths.current.delete(path);
    const now = filesRef.current;
    const index = now.findIndex((f) => f.path === path);
    const next = now.filter((f) => f.path !== path);
    setFiles((current) => current.filter((f) => f.path !== path));
    setActivePath((current) =>
      current === path ? (next[Math.min(index, next.length - 1)]?.path ?? null) : current,
    );
  }, []);

  const close = useCallback(
    (path: string) => {
      void (async () => {
        // Never lose work: a file with unsaved changes is saved before it closes, and stays open if it can't be.
        if (isUnsaved(path)) {
          await saveRef.current(path);
          if (isUnsaved(path)) return;
        }
        removeTab(path);
      })();
    },
    [removeTab],
  );

  /** Puts the workspace's text into an open file, as one undoable change, and makes it the saved text. */
  const showDiskText = useCallback(
    async (path: string, content: string, version: string) => {
      const state = latestStates.current.get(path);
      if (state === undefined) return;
      const { docOf } = await import('./editor-setup');
      const next = state.update({
        changes: { from: 0, to: state.doc.length, insert: docOf(content) },
      }).state;
      saved.current.set(path, { version, doc: next.doc });
      latestStates.current.set(path, next);
      const revision = nextRevision(revisions.current.get(path) ?? 0);
      revisions.current.set(path, revision);
      dropJournal(path, revision);
      patch(path, (file) => ({
        path: file.path,
        view: file.view,
        unsaved: false,
        save: { kind: 'idle' },
      }));
    },
    [patch, dropJournal],
  );

  /** Reads the file again; follows it if this tab has no unsaved changes, else says it changed. */
  const recheck = useCallback(
    async (path: string) => {
      const file = filesRef.current.find((f) => f.path === path);
      if (file === undefined) return;
      if (file.view.kind !== 'text') {
        void load(path);
        return;
      }
      const opened = await readFile(projectId, path, fetcher);
      const base = saved.current.get(path);
      if (base === undefined) return;
      if (opened.kind === 'refused' && opened.code === 'not_found') {
        patch(path, (f) => ({ ...f, deleted: true }));
        return;
      }
      if (opened.kind !== 'text' || opened.version === base.version) return;
      if (!isUnsaved(path)) {
        await showDiskText(path, opened.content, opened.version);
      } else {
        patch(path, (f) => ({ ...f, save: { kind: 'conflict', message: CHANGED_ON_DISK } }));
      }
    },
    [projectId, fetcher, patch, load, showDiskText],
  );

  recheckRef.current = recheck;

  const onDiskEvent = useCallback(
    (event: DiskEvent) => {
      if (event.type === 'overflow') {
        for (const file of filesRef.current) void recheck(file.path);
        return;
      }
      const file = filesRef.current.find((f) => f.path === event.path);
      if (file === undefined) return;
      if (event.deleted) {
        // A tab without unsaved changes says so too, and keeps its text until it's closed (owner, 8 Nov 2026).
        patch(event.path, (f) => ({ ...f, deleted: true }));
        return;
      }
      if (file.deleted === true) patch(event.path, (f) => ({ ...f, deleted: false }));
      const mine = ownVersions.current.get(event.path);
      if (event.version !== null && mine?.has(event.version) === true) {
        mine.delete(event.version);
        return;
      }
      if (event.version !== null && event.version === saved.current.get(event.path)?.version)
        return;
      // A save on its way: check once it's answered (save() does), not against a version about to change.
      if (file.save.kind === 'saving') {
        recheckAfterSave.current.add(event.path);
        return;
      }
      void recheck(event.path);
    },
    [patch, recheck],
  );

  /** Writes my text over the workspace's version, knowingly: the save is checked against what's there now. */
  const keepMine = useCallback(
    async (path: string) => {
      const opened = await readFile(projectId, path, fetcher);
      const base = saved.current.get(path);
      if (base === undefined) return;
      // The file may have been deleted: then the save creates it again (owner, 8 Nov 2026).
      base.version = opened.kind === 'text' ? opened.version : null;
      if (opened.kind !== 'text' && !(opened.kind === 'refused' && opened.code === 'not_found')) {
        patch(path, (f) => ({
          ...f,
          save: {
            kind: 'failed',
            message: opened.kind === 'refused' ? opened.message : 'This file isn’t text any more.',
          },
        }));
        return;
      }
      patch(path, (f) => ({ ...f, deleted: false, save: { kind: 'idle' } }));
      await saveRef.current(path);
    },
    [projectId, fetcher, patch],
  );

  /** Drops my changes and shows the workspace's version. */
  const loadDisk = useCallback(
    async (path: string) => {
      const opened = await readFile(projectId, path, fetcher);
      if (opened.kind === 'text') await showDiskText(path, opened.content, opened.version);
      else if (opened.kind === 'refused' && opened.code === 'not_found')
        patch(path, (f) => ({ ...f, deleted: true }));
    },
    [projectId, fetcher, showDiskText, patch],
  );

  /** Closes without saving: the person chose to drop the changes of a file deleted in the workspace. */
  const discard = useCallback(
    (path: string) => {
      dropJournal(path, Number.MAX_SAFE_INTEGER);
      removeTab(path);
    },
    [dropJournal, removeTab],
  );

  const updated = useCallback(
    (path: string, state: EditorState) => {
      const previous = latestStates.current.get(path);
      latestStates.current.set(path, state);
      if (previous?.doc === state.doc) return;
      revisions.current.set(path, nextRevision(revisions.current.get(path) ?? 0));
      const unsaved = isUnsaved(path);
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
      if (!unsaved) {
        // Undone back to the file on disk: nothing to keep, nothing to save.
        const timer = autosaveTimers.current.get(path);
        if (timer !== undefined) clearTimeout(timer);
        autosaveTimers.current.delete(path);
        if (journaled.current.has(path)) dropJournal(path, revisions.current.get(path) ?? 0);
        return;
      }
      if (!localTimers.current.has(path)) {
        localTimers.current.set(
          path,
          setTimeout(() => {
            localTimers.current.delete(path);
            const latest = latestStates.current.get(path);
            const base = saved.current.get(path);
            if (latest === undefined || base === undefined || latest.doc.eq(base.doc)) return;
            void local
              .put(projectId, {
                path,
                content: latest.sliceDoc(),
                baseVersion: base.version,
                revision: revisions.current.get(path) ?? 0,
                updatedAt: Date.now(),
              })
              .catch(() => undefined);
          }, LOCAL_COPY_MS),
        );
      }
      if (!journalTimers.current.has(path)) {
        journalTimers.current.set(
          path,
          setTimeout(() => void journalNow(path), timings.journalMs),
        );
      }
      if (autosaveOn.current && !inConflict(path)) {
        const timer = autosaveTimers.current.get(path);
        if (timer !== undefined) clearTimeout(timer);
        autosaveTimers.current.set(
          path,
          setTimeout(() => {
            autosaveTimers.current.delete(path);
            if (autosaveOn.current && !inConflict(path) && isUnsaved(path))
              void saveRef.current(path);
          }, timings.autosaveMs),
        );
      }
    },
    [journalNow, dropJournal, timings, local, projectId],
  );

  // Leaving the window autosaves; the page being hidden or closed journals everything at once (a keepalive
  // request outlives the page, and the browser's copy is written too).
  useEffect(() => {
    const onBlur = () => {
      flush();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        for (const file of filesRef.current) void journalNow(file.path, true);
      }
    };
    const onPageHide = () => {
      for (const file of filesRef.current) void journalNow(file.path, true);
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush, journalNow]);

  // Timers end with the page.
  useEffect(
    () => () => {
      for (const timers of [journalTimers.current, autosaveTimers.current, localTimers.current]) {
        for (const timer of timers.values()) clearTimeout(timer);
      }
    },
    [],
  );

  const setAutosave = useCallback((on: boolean) => {
    setAutosaveState(on);
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, on ? 'on' : 'off');
    } catch {
      // Not remembering the choice is fine.
    }
  }, []);

  const active = useMemo(() => files.find((file) => file.path === activePath), [files, activePath]);

  return {
    files,
    active,
    open,
    reveal,
    show,
    close,
    save,
    latest: (path) => latestStates.current.get(path),
    updated,
    flush,
    autosave,
    setAutosave,
    onDiskEvent,
    keepMine,
    loadDisk,
    discard,
  };
}
