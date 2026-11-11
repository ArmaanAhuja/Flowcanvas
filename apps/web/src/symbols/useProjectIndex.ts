// The page's view of the project index (phase 4): its status while it's indexing, and symbol search for ⌘K.
import { FILES_PREFIX, type PaletteSymbol } from '@flowcanvas/ui';
import { useEffect, useRef, useState } from 'react';
import { fetchIndexStatus, searchSymbols, type IndexStatus } from './api';

export const POLL = {
  /** How often the status is asked for while the first index runs. */
  indexingMs: 1000,
  /** After the API couldn't answer (the engine starting, the host restarting). */
  retryMs: 5000,
} as const;

/**
 * The index's status while the workspace runs. The first request starts the engine; the status is asked for
 * again while it indexes, and no more once it's ready or has failed (changes are then followed in the
 * workspace by themselves). Asking never counts as activity, so this never keeps a workspace awake.
 */
export function useProjectIndex(
  projectId: string,
  running: boolean,
  fetcher: typeof fetch,
): { readonly status: IndexStatus | undefined; readonly problem: string | undefined } {
  const [status, setStatus] = useState<IndexStatus | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!running) {
      setStatus(undefined);
      setProblem(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time: the next is asked for only after this one's answer.
    const ask = async () => {
      const result = await fetchIndexStatus(projectId, fetcher);
      if (stopped) return;
      if ('state' in result) {
        setStatus(result);
        setProblem(undefined);
        if (result.state === 'starting' || result.state === 'indexing') {
          timer = setTimeout(() => void ask(), POLL.indexingMs);
        }
      } else {
        setProblem(result.message);
        timer = setTimeout(() => void ask(), POLL.retryMs);
      }
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, running, fetcher]);

  return { status, problem };
}

/**
 * Symbols for what's typed in the palette, searched on every change. A search typed past is cancelled, and an
 * answer that arrives late for an older query is dropped, so results always match what's in the field.
 */
export function useSymbolSearch(
  projectId: string,
  query: string,
  enabled: boolean,
  fetcher: typeof fetch,
): { readonly symbols: readonly PaletteSymbol[]; readonly problem: string | undefined } {
  const [symbols, setSymbols] = useState<readonly PaletteSymbol[]>([]);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => {
    const words = query.trim();
    const asked = ++latest.current;
    if (!enabled || words === '' || query.startsWith(FILES_PREFIX)) {
      setSymbols([]);
      setProblem(undefined);
      return;
    }
    const controller = new AbortController();
    searchSymbols(projectId, words, fetcher, controller.signal).then(
      (result) => {
        if (asked !== latest.current) return;
        if ('symbols' in result) {
          setSymbols(result.symbols);
          setProblem(undefined);
        } else {
          setSymbols([]);
          setProblem(result.message);
        }
      },
      () => undefined, // cancelled: a newer search is on its way
    );
    return () => {
      controller.abort();
    };
  }, [projectId, query, enabled, fetcher]);

  return { symbols, problem };
}
