// Saving and never losing work (phase 3 step 6): autosave, the journal in the workspace and this browser, and
// restoring unsaved changes when a file opens again. A fake workspace with real versions, conflict checks and
// journal rules; edits are real CodeMirror transactions.
// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryJournal, type JournalEntry } from './journal';
import { CHANGED_ON_DISK, CONFLICT_ON_RESTORE, useCodeFiles, type Timings } from './useCodeFiles';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const FAST: Timings = { autosaveMs: 80, journalMs: 30 };
const P = 'src/index.ts';

/** The workspace as the agent keeps it: files on disk and the journal, with the agent's rules. */
class FakeWorkspace {
  readonly disk = new Map<string, string>([[P, 'export const a = 1;\n']]);
  readonly journal = new Map<string, JournalEntry>();
  readonly requests: string[] = [];
  readonly keepalive: string[] = [];
  /** While set, a save is written at once but answered only when it resolves. */
  holdSaves: Promise<void> | undefined;

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'https://f.example',
    );
    const path = url.searchParams.get('path') ?? '';
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const json = (value: unknown, status = 200) =>
      Promise.resolve(Response.json(value, { status }));
    const route = url.pathname.replace(/^\/api\/projects\/p\/workspace/, '');
    this.requests.push(`${method} ${route}${path === '' ? '' : ` ${path}`}`);
    if (init?.keepalive === true) this.keepalive.push(`${method} ${route} ${path}`);
    if (route === '/file' && method === 'GET') {
      const content = this.disk.get(path);
      return content === undefined
        ? json({ error: 'nothing', code: 'not_found' }, 404)
        : json({ path, content, encoding: 'utf8', size: content.length, version: sha(content) });
    }
    if (route === '/file' && method === 'PUT') {
      const current = this.disk.get(path);
      if ((current === undefined ? null : sha(current)) !== body.baseVersion) {
        return json(
          { error: 'This file changed in the workspace since you opened it.', code: 'conflict' },
          409,
        );
      }
      const content = String(body.content);
      this.disk.set(path, content);
      // Written now; the answer can be held back, as a slow network would.
      const answer = () => json({ path, size: content.length, version: sha(content) });
      return this.holdSaves === undefined ? answer() : this.holdSaves.then(answer);
    }
    if (route === '/journal')
      return json({
        entries: [...this.journal.values()].map((entry) => ({
          path: entry.path,
          revision: entry.revision,
        })),
      });
    if (route === '/journal/entry' && method === 'PUT') {
      const revision = Number(body.revision);
      const existing = this.journal.get(path);
      if (existing === undefined || existing.revision <= revision) {
        this.journal.set(path, {
          path,
          content: String(body.content),
          baseVersion: (body.baseVersion as string | null) ?? null,
          revision,
          updatedAt: Date.UTC(2026, 10, 8, 14, 2),
        });
      }
      return json({ path, revision });
    }
    if (route === '/journal/entry' && method === 'GET') {
      const entry = this.journal.get(path);
      return entry === undefined ? json({ error: 'none', code: 'not_found' }, 404) : json(entry);
    }
    if (route === '/journal/entry' && method === 'DELETE') {
      const entry = this.journal.get(path);
      if (entry !== undefined && entry.revision <= Number(url.searchParams.get('revision')))
        this.journal.delete(path);
      return json({ path, dropped: true });
    }
    return json({ error: 'no' }, 404);
  };
}

let workspace: FakeWorkspace;
let local: ReturnType<typeof memoryJournal>;

beforeEach(() => {
  workspace = new FakeWorkspace();
  local = memoryJournal();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount(options: { timings?: Timings } = {}) {
  return renderHook(() =>
    useCodeFiles('p', workspace.fetch, true, { timings: options.timings ?? FAST, local }),
  );
}

type Hook = ReturnType<typeof mount>['result'];

async function opened(result: Hook, path = P) {
  act(() => {
    result.current.open(path);
  });
  await waitFor(() => {
    expect(result.current.files.find((file) => file.path === path)?.view.kind).toBe('text');
  });
}

/** Types into the file, as the editor would report it. */
function type(result: Hook, text: string, path = P) {
  const state = result.current.latest(path);
  if (state === undefined) throw new Error('not open');
  act(() => {
    result.current.updated(path, state.update({ changes: { from: 0, insert: text } }).state);
  });
}

const text = (result: Hook, path = P) => result.current.latest(path)?.doc.toString();
const file = (result: Hook, path = P) => result.current.files.find((f) => f.path === path);
const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('autosave', () => {
  it('saves a pause after typing, from the opened version, then clears the journal', async () => {
    const { result } = mount();
    await opened(result);
    type(result, '// a\n');
    expect(file(result)?.unsaved).toBe(true);
    await waitFor(() => {
      expect(workspace.disk.get(P)).toBe('// a\nexport const a = 1;\n');
    });
    await waitFor(() => {
      expect(file(result)?.unsaved).toBe(false);
    });
    expect(file(result)?.save.kind).toBe('saved');
    await waitFor(() => {
      expect(workspace.journal.size).toBe(0);
    });
    expect(local.entries.size).toBe(0);
  });

  it('waits for the pause: typing again restarts the wait', async () => {
    const { result } = mount({ timings: { autosaveMs: 150, journalMs: 1000 } });
    await opened(result);
    type(result, 'a');
    await pause(100);
    type(result, 'b');
    await pause(100);
    expect(workspace.disk.get(P)).toBe('export const a = 1;\n');
    await waitFor(() => {
      expect(workspace.disk.get(P)).toBe('baexport const a = 1;\n');
    });
  });

  it('saves the file being left when another is shown', async () => {
    workspace.disk.set('b.ts', 'b');
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    type(result, 'x');
    await opened(result, 'b.ts');
    act(() => {
      result.current.show(P);
    });
    act(() => {
      result.current.show('b.ts');
    });
    await waitFor(() => {
      expect(workspace.disk.get(P)).toBe('xexport const a = 1;\n');
    });
  });

  it('can be turned off (remembered): then nothing is written, but the journal keeps the changes', async () => {
    const { result } = mount();
    await opened(result);
    act(() => {
      result.current.setAutosave(false);
    });
    expect(localStorage.getItem('flowcanvas-autosave')).toBe('off');
    type(result, 'kept ');
    await pause(200);
    expect(workspace.disk.get(P)).toBe('export const a = 1;\n');
    expect(workspace.journal.get(P)).toMatchObject({
      content: 'kept export const a = 1;\n',
      baseVersion: sha('export const a = 1;\n'),
    });
    expect(local.entries.size).toBe(1);
    act(() => {
      result.current.flush();
    });
    await pause(50);
    expect(workspace.disk.get(P)).toBe('export const a = 1;\n');
  });

  it('keeps a file’s Windows line breaks when it saves', async () => {
    workspace.disk.set('win.ts', 'a\r\nb\r\n');
    const { result } = mount();
    await opened(result, 'win.ts');
    type(result, 'z', 'win.ts');
    await waitFor(() => {
      expect(workspace.disk.get('win.ts')).toBe('za\r\nb\r\n');
    });
  });
});

describe('the journal', () => {
  it('keeps unsaved changes in the workspace and this browser, with rising revisions', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 30 } });
    await opened(result);
    type(result, 'one ');
    await waitFor(() => {
      expect(workspace.journal.get(P)?.content).toBe('one export const a = 1;\n');
    });
    const first = workspace.journal.get(P)?.revision ?? 0;
    type(result, 'two ');
    await waitFor(() => {
      expect(workspace.journal.get(P)?.content).toBe('two one export const a = 1;\n');
    });
    expect(workspace.journal.get(P)?.revision).toBeGreaterThan(first);
    expect([...local.entries.values()][0]?.content).toBe('two one export const a = 1;\n');
  });

  it('drops the journal when the text is undone back to the file', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 10 } });
    await opened(result);
    const original = result.current.latest(P);
    type(result, 'x');
    await waitFor(() => {
      expect(workspace.journal.size).toBe(1);
    });
    act(() => {
      if (original !== undefined)
        result.current.updated(P, original.update({ changes: { from: 0, to: 0 } }).state);
    });
    // The same text as on disk (a new state, as an undo makes).
    const back = result.current.latest(P);
    act(() => {
      if (back !== undefined) {
        result.current.updated(
          P,
          back.update({
            changes: { from: 0, to: back.doc.length, insert: 'export const a = 1;\n' },
          }).state,
        );
      }
    });
    expect(file(result)?.unsaved).toBe(false);
    await waitFor(() => {
      expect(workspace.journal.size).toBe(0);
    });
  });

  it('writes everything when the page goes away, with keepalive', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    type(result, 'last words ');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => {
      expect(workspace.journal.get(P)?.content).toBe('last words export const a = 1;\n');
    });
    expect(workspace.keepalive).toEqual([`PUT /journal/entry ${P}`]);
  });
});

describe('restoring (Done when: edits survive closing the tab and reopening)', () => {
  it('reopens with the unsaved changes, unsaved, saving from the version they were made on', async () => {
    const first = mount({ timings: { autosaveMs: 60_000, journalMs: 10 } });
    await opened(first.result);
    type(first.result, 'draft ');
    await waitFor(() => {
      expect(workspace.journal.size).toBe(1);
    });
    first.unmount();

    const again = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(again.result);
    expect(text(again.result)).toBe('draft export const a = 1;\n');
    expect(file(again.result)?.unsaved).toBe(true);
    expect(file(again.result)?.restored?.at).toBe(Date.UTC(2026, 10, 8, 14, 2));
    await act(() => again.result.current.save(P));
    expect(workspace.disk.get(P)).toBe('draft export const a = 1;\n');
    expect(file(again.result)?.restored).toBeUndefined();
  });

  it('opens files with unsaved changes in the workspace journal, even if they weren’t open here', async () => {
    workspace.disk.set('other.ts', 'o');
    workspace.journal.set('other.ts', {
      path: 'other.ts',
      content: 'from another tab',
      baseVersion: sha('o'),
      revision: 5,
      updatedAt: 1,
    });
    const { result } = mount();
    await waitFor(() => {
      expect(text(result, 'other.ts')).toBe('from another tab');
    });
  });

  it('takes the newer of the two copies', async () => {
    workspace.journal.set(P, {
      path: P,
      content: 'older',
      baseVersion: sha('export const a = 1;\n'),
      revision: 10,
      updatedAt: 1,
    });
    await local.put('p', {
      path: P,
      content: 'newer',
      baseVersion: sha('export const a = 1;\n'),
      revision: 20,
      updatedAt: 2,
    });
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    expect(text(result)).toBe('newer');
  });

  it('never lets a restore overwrite a newer change on disk: it shows the conflict and keeps both', async () => {
    workspace.journal.set(P, {
      path: P,
      content: 'my draft',
      baseVersion: sha('the version I edited'),
      revision: 3,
      updatedAt: 1,
    });
    const { result } = mount();
    await opened(result);
    expect(text(result)).toBe('my draft');
    expect(file(result)?.save).toEqual({ kind: 'conflict', message: CONFLICT_ON_RESTORE });
    type(result, '!');
    await pause(200);
    expect(workspace.disk.get(P)).toBe('export const a = 1;\n');
    await act(() => result.current.save(P));
    expect(workspace.disk.get(P)).toBe('export const a = 1;\n');
    expect(file(result)?.save.kind).toBe('conflict');
  });

  it('discards a journal copy that matches the file (already saved)', async () => {
    workspace.journal.set(P, {
      path: P,
      content: 'export const a = 1;\n',
      baseVersion: null,
      revision: 2,
      updatedAt: 1,
    });
    const { result } = mount();
    await opened(result);
    expect(file(result)?.unsaved).toBe(false);
    expect(file(result)?.restored).toBeUndefined();
    await waitFor(() => {
      expect(workspace.journal.size).toBe(0);
    });
  });
});

describe('changes in the workspace (step 7: an edit made in the terminal appears in the editor)', () => {
  const changed = (path: string, content: string) =>
    ({ type: 'changed', path, deleted: false, version: sha(content) }) as const;

  it('a file without unsaved changes follows the disk, and stays saved', async () => {
    const { result } = mount();
    await opened(result);
    workspace.disk.set(P, 'export const a = 2; // from the terminal\n');
    act(() => {
      result.current.onDiskEvent(changed(P, 'export const a = 2; // from the terminal\n'));
    });
    await waitFor(() => {
      expect(text(result)).toBe('export const a = 2; // from the terminal\n');
    });
    expect(file(result)?.unsaved).toBe(false);
  });

  it('ignores the echo of its own save, even when it arrives before the save’s answer', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    type(result, 'mine ');
    await act(() => result.current.save(P));
    const reads = workspace.requests.filter((r) => r === `GET /file ${P}`).length;
    act(() => {
      result.current.onDiskEvent(changed(P, 'mine export const a = 1;\n'));
    });
    await pause(50);
    expect(workspace.requests.filter((r) => r === `GET /file ${P}`)).toHaveLength(reads);
  });

  it('ignores its own save’s echo that arrives before the save’s answer (a slow network)', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    type(result, 'mine ');
    let release: () => void = () => undefined;
    workspace.holdSaves = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.save(P);
    });
    // The file is written; its change event arrives while the answer is still on its way.
    await waitFor(() => {
      expect(workspace.disk.get(P)).toBe('mine export const a = 1;\n');
    });
    act(() => {
      result.current.onDiskEvent(changed(P, 'mine export const a = 1;\n'));
    });
    await pause(50);
    // Still just saving: no false "changed in the workspace" while the answer is on its way.
    expect(file(result)?.save.kind).toBe('saving');
    release();
    await act(() => saving);
    expect(file(result)?.save.kind).toBe('saved');
    expect(file(result)?.unsaved).toBe(false);
  });

  it('someone else’s change during a save is shown once the save is answered, not hidden by it', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    type(result, 'mine ');
    let release: () => void = () => undefined;
    workspace.holdSaves = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.save(P);
    });
    await waitFor(() => {
      expect(workspace.disk.get(P)).toBe('mine export const a = 1;\n');
    });
    // The terminal writes after our save landed, before its answer.
    workspace.disk.set(P, 'theirs, later\n');
    act(() => {
      result.current.onDiskEvent(changed(P, 'theirs, later\n'));
    });
    workspace.holdSaves = undefined;
    release();
    await act(() => saving);
    // Our text was saved; theirs came after, so the editor follows the disk.
    await waitFor(() => {
      expect(text(result)).toBe('theirs, later\n');
    });
    expect(file(result)?.unsaved).toBe(false);
  });

  it('a file with unsaved changes says so, autosave never overwrites, and the person chooses', async () => {
    const { result } = mount();
    await opened(result);
    act(() => {
      result.current.setAutosave(false);
    });
    type(result, 'mine ');
    act(() => {
      result.current.setAutosave(true);
    });
    workspace.disk.set(P, 'theirs\n');
    act(() => {
      result.current.onDiskEvent(changed(P, 'theirs\n'));
    });
    await waitFor(() => {
      expect(file(result)?.save).toEqual({ kind: 'conflict', message: CHANGED_ON_DISK });
    });
    type(result, 'more ');
    await pause(200);
    expect(workspace.disk.get(P)).toBe('theirs\n');
    // Keep mine: written over theirs, knowingly.
    await act(() => result.current.keepMine(P));
    expect(workspace.disk.get(P)).toBe('more mine export const a = 1;\n');
    expect(file(result)?.save.kind).toBe('saved');
  });

  it('“Load the workspace’s version” drops the changes and shows the disk', async () => {
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 10 } });
    await opened(result);
    type(result, 'mine ');
    await waitFor(() => {
      expect(workspace.journal.size).toBe(1);
    });
    workspace.disk.set(P, 'theirs\n');
    act(() => {
      result.current.onDiskEvent(changed(P, 'theirs\n'));
    });
    await waitFor(() => {
      expect(file(result)?.save.kind).toBe('conflict');
    });
    await act(() => result.current.loadDisk(P));
    expect(text(result)).toBe('theirs\n');
    expect(file(result)?.unsaved).toBe(false);
    await waitFor(() => {
      expect(workspace.journal.size).toBe(0);
    });
  });

  it('a deleted file says so; without changes it closes, with changes it can be saved again or discarded', async () => {
    workspace.disk.set('b.ts', 'b\n');
    const { result } = mount({ timings: { autosaveMs: 60_000, journalMs: 60_000 } });
    await opened(result);
    await opened(result, 'b.ts');
    type(result, 'kept ');
    workspace.disk.delete(P);
    workspace.disk.delete('b.ts');
    act(() => {
      result.current.onDiskEvent({ type: 'changed', path: P, deleted: true, version: null });
      result.current.onDiskEvent({ type: 'changed', path: 'b.ts', deleted: true, version: null });
    });
    expect(file(result)?.deleted).toBe(true);
    expect(file(result, 'b.ts')?.deleted).toBe(true);
    // With unsaved changes: autosave never recreates it on its own.
    act(() => {
      result.current.flush();
    });
    await pause(50);
    expect(workspace.disk.has(P)).toBe(false);
    // "Save it again" recreates it.
    await act(() => result.current.keepMine(P));
    expect(workspace.disk.get(P)).toBe('kept export const a = 1;\n');
    expect(file(result)?.deleted).not.toBe(true);
    // Without changes: closed.
    act(() => {
      result.current.discard('b.ts');
    });
    expect(file(result, 'b.ts')).toBeUndefined();
  });

  it('after an overflow (a checkout, a dropped connection) it re-checks every open file', async () => {
    const { result } = mount();
    await opened(result);
    workspace.disk.set(P, 'checked out\n');
    act(() => {
      result.current.onDiskEvent({ type: 'overflow' });
    });
    await waitFor(() => {
      expect(text(result)).toBe('checked out\n');
    });
  });
});
