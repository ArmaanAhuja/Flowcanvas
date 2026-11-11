import { Tag } from '@flowcanvas/ui';
import type { IndexStatus } from './api';
import { indexChip } from './texts';

/**
 * The index's progress (design brief, "Still indexing": a progress chip, "Indexing 62%"; partial results are
 * usable meanwhile), with the full sentence ("Indexing 1,240 of 2,031 files…") as its tooltip. Not a live
 * region: it changes every second while indexing, and announcing each step would drown a screen reader.
 * Nothing is shown once the index is ready.
 */
export function IndexChip({
  status,
  className,
}: {
  readonly status: IndexStatus | undefined;
  readonly className?: string | undefined;
}) {
  const chip = indexChip(status);
  if (chip === undefined) return null;
  return (
    <Tag tone="neutral" title={chip.detail} className={className} data-testid="index-chip">
      {chip.label}
    </Tag>
  );
}
