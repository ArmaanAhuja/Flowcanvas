// The right panel's Calls tab (phase 5): what was asked about, and TypeScript's answer, for the page.
import type { CallPlace, CallRow, CallsView, ReferenceRow } from '@flowcanvas/ui';
import { useCallback, useRef, useState } from 'react';
import { askSemantic, type CallsAnswer } from './api';

export type CallsPosition = CallPlace;

const KIND_LABELS: Readonly<Record<string, string>> = {
  function: 'Function',
  component: 'Component',
  class: 'Class',
  method: 'Method',
  interface: 'Interface',
  type: 'Type',
  enum: 'Enum',
  constant: 'Constant',
  namespace: 'Namespace',
  heading: 'Heading',
};
export const kindLabel = (kind: string | null): string | null =>
  kind === null ? null : (KIND_LABELS[kind] ?? null);

export interface CallsState {
  readonly view: CallsView;
  readonly status: 'idle' | 'loading' | 'ready';
  readonly target: { name: string; kindLabel: string | null; place: CallPlace | null } | null;
  readonly rows: readonly CallRow[];
  readonly references: readonly ReferenceRow[];
  readonly message: string | null;
  /** Goes up with every question, so the page can bring the panel into view. */
  readonly asked: number;
}

const IDLE: CallsState = {
  view: 'callers',
  status: 'idle',
  target: null,
  rows: [],
  references: [],
  message: null,
  asked: 0,
};

function rowsOf(answer: CallsAnswer): CallRow[] {
  return answer.entries.map((entry, index) => ({
    id: `${String(index)}:${entry.name}:${entry.relation}:${entry.provenance}`,
    name: entry.name,
    kindLabel: kindLabel(entry.kind),
    container: entry.container,
    relation: entry.relation,
    provenance: entry.provenance,
    builtIn: entry.builtIn,
    place: entry.place,
    sites: entry.sites,
  }));
}

/**
 * Asks TypeScript (through the API) for a view of the name at a position; switching views asks again about the
 * same position. An answer for a question since replaced is dropped.
 */
export function useCalls(projectId: string, fetcher: typeof fetch) {
  const [state, setState] = useState<CallsState>(IDLE);
  const position = useRef<CallsPosition | null>(null);
  const latest = useRef(0);

  const ask = useCallback(
    async (view: CallsView, at: CallsPosition) => {
      position.current = at;
      const asked = ++latest.current;
      setState((now) => ({ ...now, view, status: 'loading', message: null, asked: now.asked + 1 }));
      const result = await askSemantic(projectId, view, at, fetcher);
      if (asked !== latest.current) return;
      if ('entries' in result) {
        setState((now) => ({
          ...now,
          status: 'ready',
          target:
            result.target === null
              ? null
              : {
                  name: result.target.name,
                  kindLabel: kindLabel(result.target.kind),
                  place: result.target.place,
                },
          rows: rowsOf(result),
          references: [],
          message: result.message,
        }));
      } else if ('references' in result) {
        setState((now) => ({
          ...now,
          status: 'ready',
          target:
            result.target === null
              ? null
              : {
                  name: result.target.name,
                  kindLabel: kindLabel(result.target.kind),
                  place: result.target.place,
                },
          rows: [],
          references: result.references,
          message: result.message,
        }));
      } else {
        setState((now) => ({
          ...now,
          status: 'ready',
          rows: [],
          references: [],
          message: result.message,
        }));
      }
    },
    [projectId, fetcher],
  );

  const setView = useCallback(
    (view: CallsView) => {
      if (position.current === null) {
        setState((now) => ({ ...now, view }));
        return;
      }
      void ask(view, position.current);
    },
    [ask],
  );

  /** A note in the panel without a question (e.g. no definition was found). */
  const notice = useCallback((message: string) => {
    latest.current += 1;
    setState((now) => ({ ...now, status: 'ready', message, asked: now.asked + 1 }));
  }, []);

  return { state, ask, setView, notice };
}
