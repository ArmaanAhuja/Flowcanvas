// What the page says about the project index (phase 4): the progress chip (design brief: "Indexing 62%") and the
// palette's note under Symbols. Kept apart so the palette's chunk and the page share them without pulling each
// other in.
import type { IndexStatus } from './api';

const count = (n: number) => n.toLocaleString('en');

export const INDEX_TEXT = {
  notRunning: 'Open the workspace to search its files and symbols.',
  starting: 'Starting the index…',
  stopped: 'Index stopped',
  analysing: 'Analysing…',
  analysingDetail:
    'Bringing entry points and flows up to date with the latest changes. Until then, what’s shown is from before them.',
} as const;

/** The chip's words while there's something to say, else undefined (a ready index says nothing). */
export function indexChip(
  status: IndexStatus | undefined,
): { readonly label: string; readonly detail: string } | undefined {
  if (status === undefined) return undefined;
  switch (status.state) {
    case 'starting':
      return { label: 'Indexing…', detail: INDEX_TEXT.starting };
    case 'indexing': {
      const percent = status.total === 0 ? 0 : Math.floor((status.done / status.total) * 100);
      return {
        label: `Indexing ${String(percent)}%`,
        detail: `Indexing ${count(status.done)} of ${count(status.total)} files…`,
      };
    }
    case 'failed':
      return { label: INDEX_TEXT.stopped, detail: status.message ?? INDEX_TEXT.stopped };
    case 'ready':
      // Ready, but not following changes: worth saying, since results may be out of date.
      if (status.message !== null) return { label: 'Index paused', detail: status.message };
      // Behind the latest edit (phase 4 of build plan v2): never shown as up to date.
      return status.analysing
        ? { label: INDEX_TEXT.analysing, detail: INDEX_TEXT.analysingDetail }
        : undefined;
  }
}

/** The palette's note under Symbols: progress, why symbols aren't available, or nothing. */
export function paletteNote(
  running: boolean,
  status: IndexStatus | undefined,
  problem: string | undefined,
): string | undefined {
  if (!running) return INDEX_TEXT.notRunning;
  if (problem !== undefined) return `Symbols aren’t available: ${problem}`;
  return indexChip(status)?.detail;
}
