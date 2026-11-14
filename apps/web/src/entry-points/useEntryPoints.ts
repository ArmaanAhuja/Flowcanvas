// The project's entry points for the left panel (phase 8): every screen, API route and command, loaded a page at a
// time once the graph has them, and a screen's elements when it's opened. Asked for again when the graph has a new
// version. None of it counts as activity (the control plane), so it never keeps a workspace awake.
import type { EntryGroup, EntryRow } from '@flowcanvas/ui';
import type { EntryPointItem } from '@flowcanvas/graph-model';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEntryPoints, type EntryKind } from './api';

export const ENTRY_POLL = {
  /** While the graph is being built. */
  buildingMs: 3000,
  /** Once listed: is there a newer version? (One entry point is asked for.) */
  versionMs: 20_000,
  /** After the API couldn't answer. */
  retryMs: 5000,
} as const;

/** A page of the API's most; and at most this many pages of a kind (Twenty's largest kind is under 4). */
const PAGE = 200;
const MOST_PAGES = 50;
const LISTED: readonly EntryKind[] = ['screen', 'api-route', 'cli-command'];

export interface EntryPointsState {
  readonly status: 'idle' | 'loading' | 'ready';
  /** Said in the panel: the graph still being built, a failure. */
  readonly message: string | null;
  readonly lists: Readonly<
    Record<'screen' | 'api-route' | 'cli-command', readonly EntryPointItem[]>
  >;
  /** Each opened screen's elements, by its id. */
  readonly elements: ReadonlyMap<string, readonly EntryPointItem[]>;
}

const EMPTY_LISTS: EntryPointsState['lists'] = { screen: [], 'api-route': [], 'cli-command': [] };

export function useEntryPoints(projectId: string, running: boolean, fetcher: typeof fetch) {
  const [state, setState] = useState<EntryPointsState>({
    status: 'idle',
    message: null,
    lists: EMPTY_LISTS,
    elements: new Map(),
  });
  const version = useRef<string | null>(null);

  /** Every page of a kind, or of a screen's elements; null when an answer said there's nothing yet or failed. */
  const all = useCallback(
    async (
      kind: EntryKind,
      screen?: string,
    ): Promise<
      | { readonly entries: readonly EntryPointItem[] }
      | { readonly problem: string | null; readonly building?: boolean }
    > => {
      const found: EntryPointItem[] = [];
      for (let page = 0, after: number | null = 0; after !== null && page < MOST_PAGES; page += 1) {
        const answer = await fetchEntryPoints(
          projectId,
          { kind, after, limit: PAGE, ...(screen === undefined ? {} : { screen }) },
          fetcher,
        );
        if (!('entries' in answer)) return { problem: answer.message };
        if (answer.message !== null) return { problem: answer.message, building: true };
        version.current = answer.version;
        found.push(...answer.entries);
        after = answer.next;
      }
      return { entries: found };
    },
    [projectId, fetcher],
  );

  useEffect(() => {
    if (!running) {
      setState({ status: 'idle', message: null, lists: EMPTY_LISTS, elements: new Map() });
      version.current = null;
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
      const lists: Record<string, readonly EntryPointItem[]> = {};
      for (const kind of LISTED) {
        const result = await all(kind);
        if (stopped) return;
        if (!('entries' in result)) {
          setState((s) => ({ ...s, status: 'loading', message: result.problem ?? null }));
          timer = setTimeout(
            () => void load(),
            result.building === true ? ENTRY_POLL.buildingMs : ENTRY_POLL.retryMs,
          );
          return;
        }
        lists[kind] = result.entries;
      }
      setState({
        status: 'ready',
        message: null,
        lists: lists as EntryPointsState['lists'],
        elements: new Map(),
      });
      timer = setTimeout(() => void watch(), ENTRY_POLL.versionMs);
    };
    // A newer version: everything again (the elements opened are asked for again when opened).
    const watch = async () => {
      const answer = await fetchEntryPoints(
        projectId,
        { kind: 'cli-command', after: 0, limit: 1 },
        fetcher,
      );
      if (stopped) return;
      if ('entries' in answer && answer.version !== null && answer.version !== version.current) {
        void load();
        return;
      }
      timer = setTimeout(() => void watch(), ENTRY_POLL.versionMs);
    };
    void load();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, running, fetcher, all]);

  const openScreen = useCallback(
    async (screen: string) => {
      const result = await all('element', screen);
      if ('entries' in result) {
        setState((s) => ({ ...s, elements: new Map([...s.elements, [screen, result.entries]]) }));
      }
    },
    [all],
  );

  return { ...state, openScreen };
}

const rowOf = (item: EntryPointItem): EntryRow => ({
  id: item.id,
  kind: item.kind,
  label: item.name,
  complete: item.complete,
  why: item.why,
});

/** The panel's groups from what's loaded, filtered by name (and a screen by its component's name too). */
export function entryGroups(state: EntryPointsState, filter: string): EntryGroup[] {
  const words = filter.trim().toLowerCase();
  const matches = (item: EntryPointItem) =>
    words === '' ||
    item.name.toLowerCase().includes(words) ||
    (item.kind === 'screen' && (item.handler?.name.toLowerCase().includes(words) ?? false));
  const screens = state.lists.screen.filter(matches).map((item) => {
    const elements = state.elements.get(item.id);
    return {
      ...rowOf(item),
      suffix: item.handler?.id == null ? null : item.handler.name,
      childCount: item.elements ?? 0,
      ...(elements === undefined ? {} : { children: elements.map(rowOf) }),
    };
  });
  const rows = (kind: 'api-route' | 'cli-command') => state.lists[kind].filter(matches).map(rowOf);
  return [
    { id: 'screens', count: state.lists.screen.length, rows: screens },
    { id: 'api', count: state.lists['api-route'].length, rows: rows('api-route') },
    // Jobs, cron and events come with background work (build plan, phase 11).
    { id: 'jobs', count: 0, rows: [], arrivesIn: 11 },
    { id: 'events', count: 0, rows: [], arrivesIn: 11 },
    { id: 'cli', count: state.lists['cli-command'].length, rows: rows('cli-command') },
  ];
}

/** Every entry point loaded, by id: to find what a row stands for. */
export function entryById(state: EntryPointsState): ReadonlyMap<string, EntryPointItem> {
  const found = new Map<string, EntryPointItem>();
  for (const list of Object.values(state.lists)) for (const item of list) found.set(item.id, item);
  for (const list of state.elements.values()) for (const item of list) found.set(item.id, item);
  return found;
}
