import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import { Tooltip } from '../tooltip/Tooltip';
import styles from './CanvasToolbar.module.css';

export interface CanvasToolbarProps extends ComponentPropsWithRef<'div'> {
  /** Names the toolbar for assistive technology, e.g. "Canvas". */
  readonly 'aria-label': string;
}

/**
 * The canvas's floating toolbar (Figma 06, toolbar()): tools, a divider, then zoom. 4 px padding, 2 px gaps,
 * radius 8, panel surface with a subtle border, and the popover shadow: it floats over the canvas, the one
 * kind of thing Graphite gives a shadow.
 */
export function CanvasToolbar({ className, children, ...rest }: CanvasToolbarProps) {
  return (
    <div {...rest} role="toolbar" className={classNames(styles.toolbar, className)}>
      {children}
    </div>
  );
}

/** A 1 × 16 px line between groups of tools. */
export function ToolbarDivider() {
  return <span className={styles.divider} role="separator" aria-orientation="vertical" />;
}

export interface ToolbarButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'aria-label' | 'aria-pressed'
> {
  /** Its accessible name and tooltip, with a shortcut if it has one: "Fit (F)". */
  readonly label: string;
  /** A 16 px icon (lucide-react, `size={16}`). */
  readonly icon: ReactNode;
  /** For tools (Select, Pan): which one is active. Leave undefined for plain actions (Zoom in). */
  readonly active?: boolean;
}

/** A 28 px toolbar button: a tool you switch to (`active`), or an action. */
export function ToolbarButton({ label, icon, active, className, ...rest }: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        {...rest}
        aria-label={label}
        {...(active === undefined ? {} : { 'aria-pressed': active })}
        className={classNames(styles.button, className)}
      >
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}

/** Plain text in the toolbar, such as the zoom level ("100%"). */
export function ToolbarText({ children }: { readonly children: ReactNode }) {
  return <span className={styles.text}>{children}</span>;
}
