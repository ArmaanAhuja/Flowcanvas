import { X } from 'lucide-react';
import { useEffect, useRef, type ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './EditorTabs.module.css';

export interface EditorTab {
  /** Unique, e.g. the file's path. */
  readonly id: string;
  /** What the tab shows, e.g. the file name. */
  readonly label: string;
  /** Shown on hover, e.g. the full path. */
  readonly title?: string;
  /** Changes not written to the file yet: a dot, and "unsaved changes" in its accessible name. */
  readonly unsaved?: boolean;
}

export interface EditorTabsProps extends Omit<ComponentPropsWithRef<'nav'>, 'onSelect'> {
  readonly tabs: readonly EditorTab[];
  /** The id of the file shown in the editor. */
  readonly active?: string;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
  /** Names the list, e.g. "Open files". */
  readonly 'aria-label': string;
}

/**
 * The editor's open files (Figma 11). Each tab is a button that shows its file, with its own close button; the
 * shown file is `aria-current`. A middle click closes a tab. The row scrolls sideways when the tabs don't fit, and
 * keeps the shown tab in view.
 *
 * Not ARIA tabs: a tab list may hold only tabs, and each of these has a close button too.
 */
export function EditorTabs({
  tabs,
  active,
  onSelect,
  onClose,
  className,
  ...rest
}: EditorTabsProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav {...rest} className={classNames(styles.tabs, className)}>
      <ul className={styles.list}>
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li
              key={tab.id}
              className={styles.tab}
              data-active={isActive ? '' : undefined}
              data-unsaved={tab.unsaved === true ? '' : undefined}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              <button
                type="button"
                className={styles.name}
                ref={isActive ? activeRef : undefined}
                aria-current={isActive ? 'true' : undefined}
                aria-label={tab.unsaved === true ? `${tab.label}, unsaved changes` : undefined}
                title={tab.title}
                onClick={() => {
                  onSelect(tab.id);
                }}
              >
                {tab.label}
              </button>
              <span className={styles.end}>
                {tab.unsaved === true && <span className={styles.dot} aria-hidden="true" />}
                <button
                  type="button"
                  className={styles.close}
                  aria-label={`Close ${tab.label}`}
                  onClick={() => {
                    onClose(tab.id);
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
