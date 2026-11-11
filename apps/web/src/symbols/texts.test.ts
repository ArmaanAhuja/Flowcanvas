import { EditorState } from '@codemirror/state';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { positionOf } from '../code/CodeEditor';
import type { IndexStatus } from './api';
import { INDEX_TEXT, indexChip, paletteNote } from './texts';
import { useSymbolSearch } from './useProjectIndex';

const status = (extra: Partial<IndexStatus>): IndexStatus => ({
  state: 'ready',
  done: 0,
  total: 0,
  files: 0,
  byStatus: { parsed: 0, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: 0,
  withSyntaxErrors: 0,
  partlyRead: 0,
  lastFullMs: null,
  message: null,
  ...extra,
});

describe('indexChip', () => {
  it('shows a percentage while indexing, with the counts in the detail', () => {
    expect(indexChip(status({ state: 'indexing', done: 1240, total: 2031 }))).toEqual({
      label: 'Indexing 61%',
      detail: 'Indexing 1,240 of 2,031 files…',
    });
    expect(indexChip(status({ state: 'indexing', done: 0, total: 0 }))?.label).toBe('Indexing 0%');
  });

  it('says starting, stopped (in the engine’s words), paused, or nothing', () => {
    expect(indexChip(status({ state: 'starting' }))).toEqual({
      label: 'Indexing…',
      detail: INDEX_TEXT.starting,
    });
    expect(indexChip(status({ state: 'failed', message: 'Indexing stopped.' }))).toEqual({
      label: INDEX_TEXT.stopped,
      detail: 'Indexing stopped.',
    });
    expect(indexChip(status({ message: 'Changes aren’t being followed.' }))?.label).toBe(
      'Index paused',
    );
    expect(indexChip(status({}))).toBeUndefined();
    expect(indexChip(undefined)).toBeUndefined();
  });
});

describe('paletteNote', () => {
  it('puts not running first, then a problem, then progress', () => {
    const indexing = status({ state: 'indexing', done: 1, total: 4 });
    expect(paletteNote(false, indexing, 'x')).toBe(INDEX_TEXT.notRunning);
    expect(paletteNote(true, indexing, 'No index.')).toBe('Symbols aren’t available: No index.');
    expect(paletteNote(true, indexing, undefined)).toBe('Indexing 1 of 4 files…');
    expect(paletteNote(true, status({}), undefined)).toBeUndefined();
  });
});

describe('useSymbolSearch', () => {
  it('drops a late answer for an older query, and skips # and empty queries', async () => {
    const pending = new Map<string, (body: unknown) => void>();
    const asked: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      const q = new URL(url, 'https://flowcanvas.example').searchParams.get('q') ?? '';
      asked.push(q);
      return new Promise((resolve) => {
        pending.set(q, (body) => {
          resolve(Response.json(body));
        });
      });
    };
    const hit = (name: string) => ({
      path: 'a.ts',
      name,
      kind: 'function',
      container: null,
      line: 1,
      column: 1,
      exported: false,
    });
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useSymbolSearch('p-1', query, true, fetcher),
      { initialProps: { query: 'po' } },
    );
    rerender({ query: 'poll' });
    await act(async () => {
      pending.get('poll')?.({ symbols: [hit('poll')], ms: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.symbols.map((s) => s.name)).toEqual(['poll']);
    });
    // The older search answers last: it must not replace the newer results.
    await act(async () => {
      pending.get('po')?.({ symbols: [hit('po')], ms: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.symbols.map((s) => s.name)).toEqual(['poll']);
    rerender({ query: '#poll' });
    rerender({ query: '   ' });
    expect(result.current.symbols).toEqual([]);
    expect(asked).toEqual(['po', 'poll']);
  });
});

describe('positionOf', () => {
  const state = EditorState.create({ doc: 'one\n  two 🙂 x\nthree' });
  it('turns a 1-based line and UTF-16 column into an offset', () => {
    expect(positionOf(state, 2, 3)).toBe(6);
    expect(positionOf(state, 2, 10)).toBe(4 + 9); // after the emoji's two code units
  });
  it('stays inside the document when the file has changed since it was indexed', () => {
    expect(positionOf(state, 99, 1)).toBe(state.doc.line(3).from);
    expect(positionOf(state, 1, 99)).toBe(3);
    expect(positionOf(state, 0, 0)).toBe(0);
  });
});
