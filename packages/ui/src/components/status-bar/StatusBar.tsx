import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './StatusBar.module.css';

export interface StatusBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** On the left, e.g. "Ln 43, Col 17", "Spaces: 2", "UTF-8", "TypeScript". */
  readonly items: readonly ReactNode[];
  /** On the right, e.g. the autosave switch. */
  readonly end?: ReactNode;
  /** Names the bar, e.g. "Editor status". */
  readonly 'aria-label': string;
}

/**
 * The editor's status bar (Figma 11): panel surface, a top border, Caption text in muted, 16 px apart. 28 px tall
 * (Graphite compact row). Not a live region: it changes with every cursor move, and announcing that would drown
 * a screen reader.
 */
export function StatusBar({ items, end, className, ...rest }: StatusBarProps) {
  return (
    <div {...rest} role="group" className={classNames(styles.bar, className)}>
      {items.map((item, index) => (
        <span key={index} className={styles.item}>
          {item}
        </span>
      ))}
      <span className={styles.spacer} />
      {end !== undefined && <span className={styles.item}>{end}</span>}
    </div>
  );
}
