import { Search } from 'lucide-react';
import { classNames } from '../../class-names';
import styles from './SearchTrigger.module.css';

export interface SearchTriggerProps {
  /** Opens the command palette. */
  readonly onPress: () => void;
  /** The shortcut as shown: `⌘K` on a Mac, `Ctrl K` elsewhere. */
  readonly shortcutLabel: string;
  /** The same shortcut for assistive technology (aria-keyshortcuts), e.g. `Meta+K` or `Control+K`. */
  readonly keyShortcuts: string;
}

/**
 * The top bar's search (Figma 06): looks like a field, but it's a button that opens the command palette, so
 * the palette is the one place where searching happens. 200 by 28 px (Figma: 26, moved onto the 4 px grid), the
 * search icon, "Search" and the shortcut.
 */
export function SearchTrigger({ onPress, shortcutLabel, keyShortcuts }: SearchTriggerProps) {
  return (
    // A native button: React Aria's drops aria-keyshortcuts, and nothing else here needs it.
    <button
      type="button"
      className={classNames(styles.trigger)}
      onClick={onPress}
      aria-keyshortcuts={keyShortcuts}
    >
      <Search size={14} className={classNames(styles.icon)} aria-hidden="true" />
      <span className={classNames(styles.label)}>Search</span>
      <kbd className={classNames(styles.kbd)} aria-hidden="true">
        {shortcutLabel}
      </kbd>
    </button>
  );
}
