import { ChevronRight } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbProps extends Omit<ComponentPropsWithRef<'nav'>, 'children'> {
  /** From outermost to innermost, e.g. a file's folders and name: `worker`, `process.ts`. */
  readonly segments: readonly string[];
  /** Names the trail, e.g. "File path". */
  readonly 'aria-label': string;
  /** On the right, e.g. the flow this code belongs to (Figma 11). */
  readonly end?: ReactNode;
}

/** Up to this many segments show in full; a longer trail keeps the first and the last three. */
export const MOST_SEGMENTS = 5;

/** The segments to show: long trails are cut in the middle, so the innermost (the file) always shows. */
export function shownSegments(segments: readonly string[]): readonly (string | null)[] {
  if (segments.length <= MOST_SEGMENTS) return segments;
  return [segments[0] ?? '', null, ...segments.slice(-3)];
}

/**
 * Where you are, above the editor (Figma 11): Mono small, outer segments muted, the last in primary text and
 * marked as the current location. A trail too long to show is cut in the middle ("…"), with the whole of it on
 * hover (Graphite: truncate paths in the middle, never the end).
 */
export function Breadcrumb({ segments, end, className, ...rest }: BreadcrumbProps) {
  const shown = shownSegments(segments);
  return (
    <nav {...rest} className={classNames(styles.breadcrumb, className)}>
      <ol className={styles.trail} title={segments.join(' / ')}>
        {shown.map((segment, index) => {
          const last = index === shown.length - 1;
          return (
            <li key={`${String(index)}:${segment ?? '…'}`} className={styles.segment}>
              {index > 0 && (
                <ChevronRight size={10} className={styles.chevron} aria-hidden="true" />
              )}
              {segment === null ? (
                <span aria-label={`${String(segments.length - 4)} more`}>…</span>
              ) : (
                <span
                  className={last ? styles.current : undefined}
                  aria-current={last ? 'location' : undefined}
                >
                  {segment}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {end !== undefined && <span className={styles.end}>{end}</span>}
    </nav>
  );
}
