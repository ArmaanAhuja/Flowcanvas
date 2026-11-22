// The entry points follow the engine's listings (phase 4 of build plan v2): a saved edit shows within 3 s, so they're
// asked for again as soon as the engine's status says it listed them again, not on a 20 s check for a new version.
import type { EntryPointsResult } from '@flowcanvas/engine/protocol';
import type { EntryPointItem } from '@flowcanvas/graph-model';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEntryPoints } from './useEntryPoints';

const route = (name: string): EntryPointItem => ({
  id: `a.ts#(entry ${name})`,
  kind: 'api-route',
  framework: 'hono',
  name,
  place: { path: 'a.ts', line: 1, column: 1 },
  complete: true,
  why: null,
  within: null,
  handler: null,
});

function engine() {
  let routes: readonly EntryPointItem[] = [route('GET /polls')];
  let asked = 0;
  const fetcher = ((url: string) => {
    asked += 1;
    const kind = new URL(url, 'http://localhost').searchParams.get('kind');
    const entries = kind === 'api-route' ? routes : [];
    const answer: EntryPointsResult = {
      counts: {
        screen: 0,
        element: 0,
        'api-route': routes.length,
        job: 0,
        cron: 0,
        event: 0,
        'cli-command': 0,
      },
      kind: kind as EntryPointsResult['kind'],
      entries,
      next: null,
      message: null,
      version: 'v1',
      takenAt: null,
      current: true,
      complete: true,
    };
    return Promise.resolve(new Response(JSON.stringify(answer)));
  }) as typeof fetch;
  return {
    fetcher,
    asked: () => asked,
    list: (names: string[]) => {
      routes = names.map(route);
    },
  };
}

describe('useEntryPoints (phase 4 of build plan v2)', () => {
  it('asks again when the engine lists them again, with no new version needed', async () => {
    const fake = engine();
    const { result, rerender } = renderHook(
      ({ listed }) => useEntryPoints('p1', true, fake.fetcher, listed),
      { initialProps: { listed: 1 } },
    );
    await waitFor(() => {
      expect(result.current.lists['api-route'].map((e) => e.name)).toEqual(['GET /polls']);
    });
    fake.list(['GET /polls', 'POST /polls']);
    rerender({ listed: 2 });
    await waitFor(() => {
      expect(result.current.lists['api-route'].map((e) => e.name)).toEqual([
        'GET /polls',
        'POST /polls',
      ]);
    });
    // Shown meanwhile: the earlier list, never an empty panel.
    expect(result.current.status).toBe('ready');
  });

  it('keeps an opened screen’s elements when they’re listed again', async () => {
    const fake = engine();
    const { result, rerender } = renderHook(
      ({ listed }) => useEntryPoints('p1', true, fake.fetcher, listed),
      { initialProps: { listed: 1 } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    await result.current.openScreen('a.ts#(entry /polls)');
    await waitFor(() => {
      expect(result.current.elements.has('a.ts#(entry /polls)')).toBe(true);
    });
    const before = fake.asked();
    rerender({ listed: 2 });
    await waitFor(() => {
      expect(fake.asked()).toBeGreaterThan(before + 6);
    });
    await waitFor(() => {
      expect(result.current.elements.has('a.ts#(entry /polls)')).toBe(true);
    });
  });
});
