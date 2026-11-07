import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import { Tooltip } from '../tooltip/Tooltip';
import styles from './Rail.module.css';

export interface RailProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The tools (Canvas, Entry points, Files…), from the top. */
  readonly children: ReactNode;
  /** Pinned to the bottom: Account and Settings (Figma 06). */
  readonly footer?: ReactNode;
}

/** The app shell's tool rail (Figma 06): 44 px wide, panel surface; tools at the top, account at the bottom. */
export function Rail({ children, footer, className, ...rest }: RailProps) {
  return (
    <div {...rest} className={classNames(styles.rail, className)}>
      <div className={styles.group}>{children}</div>
      {footer !== undefined && <div className={styles.group}>{footer}</div>}
    </div>
  );
}

export interface RailButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'aria-label' | 'aria-pressed'
> {
  /** The tool's name: its accessible name and its tooltip. */
  readonly label: string;
  /** An 18 px icon (lucide-react, `size={18}`). */
  readonly icon: ReactNode;
  /** Its panel is open. */
  readonly active?: boolean;
}

/** A rail tool: a 32 px icon button with its name as a tooltip, pressed while its panel is open. */
export function RailButton({ label, icon, active = false, className, ...rest }: RailButtonProps) {
  return (
    <Tooltip content={label} placement="end">
      <button
        type="button"
        {...rest}
        aria-label={label}
        aria-pressed={active}
        className={classNames(styles.button, className)}
      >
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}
