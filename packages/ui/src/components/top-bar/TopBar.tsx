import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './TopBar.module.css';

export interface TopBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Left: the logo, the project and the branch (Figma 06). */
  readonly start?: ReactNode;
  /** Centre: the view switch. */
  readonly middle?: ReactNode;
  /** Right: search, the workspace status, share and the avatar. */
  readonly end?: ReactNode;
}

/** The app shell's top bar (Figma 06): 40 px, panel surface, a hairline below; start, middle and end groups. */
export function TopBar({ start, middle, end, className, ...rest }: TopBarProps) {
  return (
    <div {...rest} className={classNames(styles.bar, className)}>
      <div className={styles.start}>{start}</div>
      <div className={styles.middle}>{middle}</div>
      <div className={styles.end}>{end}</div>
    </div>
  );
}
