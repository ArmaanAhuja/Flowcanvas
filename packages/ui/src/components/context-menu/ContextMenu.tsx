import { useRef, type ReactNode } from 'react';
import { Menu as AriaMenu, Popover as AriaPopover, type Key } from 'react-aria-components';
import { classNames } from '../../class-names';
import menuStyles from '../menu/Menu.module.css';
import styles from './ContextMenu.module.css';

export interface ContextMenuProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where it opens: the pointer's position in the viewport (a right-click), or a caret's. */
  readonly at: { readonly x: number; readonly y: number };
  readonly 'aria-label': string;
  /** MenuItem elements, as in Menu. */
  readonly children: ReactNode;
  readonly onAction: (key: Key) => void;
}

/**
 * A menu that opens where the person right-clicked (phase 5: the Code view's Go to definition, Find references,
 * Callers, Callees). The same look and keyboard as Menu: arrow keys move, Enter activates, Escape closes and focus
 * returns. An invisible anchor at the pointer is what the popover is placed against.
 */
export function ContextMenu({
  isOpen,
  onOpenChange,
  at,
  children,
  onAction,
  'aria-label': label,
}: ContextMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      {/* Positioned through the CSSOM (our CSP allows it), never a style attribute in markup. */}
      <span
        ref={(node) => {
          anchor.current = node;
          if (node !== null) {
            node.style.left = `${String(at.x)}px`;
            node.style.top = `${String(at.y)}px`;
          }
        }}
        className={classNames(styles.anchor)}
        aria-hidden="true"
      />
      <AriaPopover
        triggerRef={anchor}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        placement="bottom start"
        offset={2}
        className={classNames(menuStyles.popover)}
      >
        <AriaMenu
          aria-label={label}
          autoFocus="first"
          onAction={(key) => {
            onAction(key);
            onOpenChange(false);
          }}
          className={classNames(menuStyles.menu)}
        >
          {children}
        </AriaMenu>
      </AriaPopover>
    </>
  );
}
