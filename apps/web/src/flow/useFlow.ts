// The flow on the canvas, and the details of what's selected in it (phase 7). What took work is kept, keyed so it's
// never stale (ADR 0029): layouts by graph version and root, details by graph version and place. Going back to a
// flow or a node seen before is instant. A newer request always wins over a late answer.
import type { CodePosition, DetailsResult, FlowResult } from '@flowcanvas/engine/protocol';
import { useCallback, useRef, useState } from 'react';
import { fetchDetails, fetchFlow } from './api';
import { pageElk } from './elk';
import { layoutFlow, type ElkLike, type LaidOutEdge, type LaidOutNode } from './layout';

export interface LaidOutFlow {
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly LaidOutEdge[];
}

export type FlowState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'problem'; readonly message: string }
  | { readonly kind: 'ready'; readonly result: FlowResult; readonly laid: LaidOutFlow | null };

export type DetailsState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'problem'; readonly message: string }
  | { readonly kind: 'ready'; readonly result: DetailsResult };

/** How many layouts and details are kept: the flows and nodes looked at recently. */
export const KEPT = 50;

/** A small map that forgets the least recently used entry beyond `most`. */
export class Recent<V> {
  readonly #entries = new Map<string, V>();
  constructor(readonly most: number) {}
  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.most) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }
  get size(): number {
    return this.#entries.size;
  }
}

export function useFlow(
  projectId: string,
  fetcher: typeof fetch,
  elk: () => Promise<ElkLike> = pageElk,
) {
  const [flow, setFlow] = useState<FlowState>({ kind: 'none' });
  const [details, setDetails] = useState<DetailsState>({ kind: 'none' });
  // The groups opened (phase 12), and whether the completeness pill is pressed: the pill only changes how edges are
  // drawn, so it never lays the flow out again.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [filterWeak, setFilterWeak] = useState(false);
  const layouts = useRef(new Recent<LaidOutFlow>(KEPT));
  const detailsKept = useRef(new Recent<DetailsResult>(KEPT));
  const flowAsked = useRef(0);
  const laidAsked = useRef(0);
  const detailsAsked = useRef(0);
  const version = useRef<string | null>(null);
  const current = useRef<{ result: FlowResult; open: ReadonlySet<string> } | null>(null);

  /** A layout of the flow with these groups open: kept by graph version, root and what's open. */
  const laidOut = useCallback(
    async (result: FlowResult, open: ReadonlySet<string>) => {
      const shown = result.flow;
      if (shown === null) return null;
      const key = [
        result.version ?? '',
        shown.root,
        String(shown.nodes.length),
        [...open].sort().join(','),
      ].join('|');
      let laid = layouts.current.get(key);
      if (laid === undefined) {
        laid = await layoutFlow(shown, await elk(), { expandedGroups: open });
        layouts.current.set(key, laid);
      }
      return laid;
    },
    [elk],
  );

  const open = useCallback(
    async (at: CodePosition) => {
      const asked = ++flowAsked.current;
      setFlow({ kind: 'loading' });
      setDetails({ kind: 'none' });
      setExpandedGroups(new Set());
      setFilterWeak(false);
      current.current = null;
      const answer = await fetchFlow(projectId, at, fetcher);
      if (asked !== flowAsked.current) return;
      if (!('flow' in answer)) {
        setFlow({ kind: 'problem', message: answer.message });
        return;
      }
      version.current = answer.version;
      const laid = await laidOut(answer, new Set());
      if (asked !== flowAsked.current) return;
      current.current = { result: answer, open: new Set() };
      setFlow({ kind: 'ready', result: answer, laid });
    },
    [projectId, fetcher, laidOut],
  );

  /** Opens or closes a group (phase 12): nothing else moves, as the base layout doesn't change. */
  const toggleGroup = useCallback(
    async (groupId: string) => {
      const shown = current.current;
      if (shown === null) return;
      const next = new Set(shown.open);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      shown.open = next;
      setExpandedGroups(next);
      const asked = flowAsked.current;
      const laid = ++laidAsked.current;
      const placed = await laidOut(shown.result, next);
      // A newer flow, or a later toggle, wins over this late layout.
      if (asked !== flowAsked.current || laid !== laidAsked.current || placed === null) return;
      setFlow((prev) =>
        prev.kind === 'ready' && prev.result === shown.result ? { ...prev, laid: placed } : prev,
      );
    },
    [laidOut],
  );

  const toggleFilterWeak = useCallback(() => {
    setFilterWeak((on) => !on);
  }, []);

  /** The details of the code unit at a place (a node of the flow), or none. */
  const select = useCallback(
    async (at: CodePosition | null) => {
      const asked = ++detailsAsked.current;
      if (at === null) {
        setDetails({ kind: 'none' });
        return;
      }
      const key = `${version.current ?? ''}|${at.path}:${String(at.line)}:${String(at.column)}`;
      const kept = detailsKept.current.get(key);
      if (kept !== undefined) {
        setDetails({ kind: 'ready', result: kept });
        return;
      }
      setDetails({ kind: 'loading' });
      const answer = await fetchDetails(projectId, at, fetcher);
      if (asked !== detailsAsked.current) return;
      if (!('details' in answer)) {
        setDetails({ kind: 'problem', message: answer.message });
        return;
      }
      if (answer.details !== null) detailsKept.current.set(key, answer);
      setDetails({ kind: 'ready', result: answer });
    },
    [projectId, fetcher],
  );

  const close = useCallback(() => {
    flowAsked.current += 1;
    detailsAsked.current += 1;
    current.current = null;
    setFlow({ kind: 'none' });
    setDetails({ kind: 'none' });
  }, []);

  return {
    flow,
    details,
    open,
    select,
    close,
    filterWeak,
    toggleFilterWeak,
    toggleGroup,
    expandedGroups,
  };
}
