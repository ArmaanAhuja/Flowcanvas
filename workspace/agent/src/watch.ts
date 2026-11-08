// The project's file watcher (phase 3 step 3, ADR 0021): reports every file created, changed or deleted, so the
// editor sees an edit made in the terminal. It watches folders, not files (`sed -i` replaces a file with a new
// one), and skips node_modules, .git and build output, because each folder takes one inotify watch from a pool
// the whole computer shares.
import { watch, type FSWatcher } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { versionOf } from './agent.js';
import {
  IGNORED_DIRECTORIES,
  LIMITS,
  WATCH_LIMITS,
  isSecretFile,
  type Version,
  type WatchEvent,
} from './protocol.js';

export interface Watcher {
  close(): void;
}

export interface WatcherOptions {
  readonly root: string;
  readonly emit: (event: WatchEvent) => void;
  /** Tests make these small. */
  readonly coalesceMs?: number;
  readonly pending?: number;
  readonly folders?: number;
}

const join = (folder: string, name: string) => (folder === '' ? name : `${folder}/${name}`);
const inside = (path: string, folder: string) => path.startsWith(`${folder}/`);
const nameOf = (path: string) => path.split('/').pop() ?? '';

export async function startWatcher(options: WatcherOptions): Promise<Watcher> {
  const base = await realpath(options.root);
  const coalesceMs = options.coalesceMs ?? WATCH_LIMITS.coalesceMs;
  const most = options.pending ?? WATCH_LIMITS.pending;
  const mostFolders = options.folders ?? WATCH_LIMITS.folders;
  const watched = new Map<string, FSWatcher>();
  /** Known files and the version last reported (or found at the start); null when too large to read. */
  const known = new Map<string, Version | null>();
  const pending = new Set<string>();
  let overflowed = false;
  let timer: NodeJS.Timeout | undefined;
  let flushing: Promise<void> = Promise.resolve();
  let closed = false;
  let toldTooMany = false;

  const abs = (path: string) => resolve(base, path);

  async function versionAt(path: string): Promise<Version | null> {
    const stats = await lstat(abs(path));
    return stats.size > LIMITS.fileBytes ? null : versionOf(await readFile(abs(path)));
  }

  function schedule(path: string): void {
    if (closed) return;
    if (pending.size >= most) overflowed = true;
    else pending.add(path);
    timer ??= setTimeout(() => {
      timer = undefined;
      flushing = flushing.then(flush, flush);
    }, coalesceMs);
  }

  function unwatch(folder: string): void {
    for (const [path, watcher] of watched) {
      if (path === folder || inside(path, folder)) {
        watcher.close();
        watched.delete(path);
      }
    }
  }

  /** Watches a folder and everything below it; returns the files found (with their versions, if `read`). */
  async function addFolder(folder: string, read: boolean): Promise<Map<string, Version | null>> {
    const found = new Map<string, Version | null>();
    const queue = [folder];
    while (queue.length > 0) {
      const current = queue.shift() ?? '';
      if (watched.has(current)) continue;
      if (watched.size >= mostFolders) {
        if (!toldTooMany) {
          toldTooMany = true;
          options.emit({
            type: 'error',
            message:
              'This project has too many folders to watch them all; some changes won’t show.',
          });
        }
        return found;
      }
      let watcher: FSWatcher;
      try {
        watcher = watch(abs(current), (_event, name) => {
          if (typeof name === 'string' && name !== '') schedule(join(current, name));
        });
      } catch {
        continue; // Gone already, or not readable: nothing to watch.
      }
      // A deleted folder's watcher errors or goes quiet; the parent's event removes it.
      watcher.on('error', () => {
        unwatch(current);
      });
      watched.set(current, watcher);
      const dirents = await readdir(abs(current), { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        const path = join(current, dirent.name);
        if (dirent.isDirectory()) {
          if (!IGNORED_DIRECTORIES.includes(dirent.name)) queue.push(path);
        } else if (dirent.isFile() && !isSecretFile(dirent.name)) {
          found.set(path, read ? await versionAt(path).catch(() => null) : null);
        }
      }
    }
    return found;
  }

  function changed(path: string, version: Version | null): void {
    known.set(path, version);
    options.emit({ type: 'changed', path, deleted: false, version });
  }

  function deleted(path: string): void {
    known.delete(path);
    options.emit({ type: 'changed', path, deleted: true, version: null });
  }

  async function check(path: string): Promise<void> {
    const stats = await lstat(abs(path)).catch(() => undefined);
    if (stats === undefined) {
      // Gone: a file, or a folder with everything in it.
      if (known.has(path)) deleted(path);
      if (watched.has(path)) {
        unwatch(path);
        for (const file of [...known.keys()]) if (inside(file, path)) deleted(file);
      }
      return;
    }
    if (stats.isDirectory()) {
      if (IGNORED_DIRECTORIES.includes(nameOf(path)) || watched.has(path)) return;
      // A new folder (made, moved in, or checked out): watch it and report what's already in it.
      for (const [file, version] of await addFolder(path, true)) changed(file, version);
      return;
    }
    if (!stats.isFile() || isSecretFile(nameOf(path))) return;
    const version = await versionAt(path).catch(() => undefined);
    if (version === undefined) return; // Deleted between the two looks: the next event says so.
    // Many notifications for one save: report only a real change.
    if (known.has(path) && known.get(path) === version && version !== null) return;
    changed(path, version);
  }

  /** After an overflow: bring the picture up to date without reporting each file. */
  async function resync(): Promise<void> {
    const now = await addFolder('', false);
    for (const folder of [...watched.keys()]) {
      if (
        !(await lstat(abs(folder)).then(
          (s) => s.isDirectory(),
          () => false,
        ))
      )
        unwatch(folder);
    }
    for (const file of [...known.keys()]) if (!now.has(file)) known.delete(file);
    for (const [file] of now)
      if (!known.has(file)) known.set(file, await versionAt(file).catch(() => null));
  }

  async function flush(): Promise<void> {
    if (closed) return;
    if (overflowed) {
      overflowed = false;
      pending.clear();
      options.emit({ type: 'overflow' });
      await resync();
      return;
    }
    const paths = [...pending].sort();
    pending.clear();
    for (const path of paths) await check(path);
  }

  for (const [file, version] of await addFolder('', true)) known.set(file, version);
  options.emit({ type: 'ready', folders: watched.size, files: known.size });

  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const watcher of watched.values()) watcher.close();
      watched.clear();
    },
  };
}
