import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import { Tabs, type TabItem } from '../tabs/Tabs';
import styles from './ReviewBar.module.css';

export interface ReviewBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Changed, Affected, Tests, Observed, Unverified, each with a count (Figma 06). None before a session. */
  readonly tabs?: readonly TabItem[];
  readonly value?: string;
  readonly onValueChange?: (id: string) => void;
  /** A short caption, e.g. "Session · 4 steps · 2 min ago", or why there's nothing to review. */
  readonly summary?: ReactNode;
  /** On the right: Revert step, Compare, Accept. */
  readonly actions?: ReactNode;
}

/** The app shell's review bar (Figma 06): 40 px, panel surface; tabs with counts, a summary, actions. */
export function ReviewBar({
  tabs = [],
  value,
  onValueChange,
  summary,
  actions,
  className,
  ...rest
}: ReviewBarProps) {
  return (
    <div {...rest} className={classNames(styles.bar, className)}>
      {tabs.length > 0 && (
        <Tabs
          aria-label="Review"
          variant="pill"
          items={tabs}
          {...(value === undefined ? {} : { value })}
          {...(onValueChange === undefined ? {} : { onValueChange })}
        />
      )}
      <span className={styles.spacer} />
      {summary !== undefined && <span className={styles.summary}>{summary}</span>}
      {actions !== undefined && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}
