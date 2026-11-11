// What the page says about the project index (phase 4): the progress chip (design brief: "Indexing 62%") and the
// palette's note under Symbols. Kept apart so the palette's chunk and the page share them without pulling each
// other in.
import type { IndexStatus } from './api';

const count = (n: number) => n.toLocaleString('en');

export const INDEX_TEXT = {
  notRunning: 'Open the workspace to search its files and symbols.',
  starting: 'Starting the index…',
  stopped: 'Index stopped',
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
      return status.message === null
        ? undefined
        : { label: 'Index paused', detail: status.message };
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
