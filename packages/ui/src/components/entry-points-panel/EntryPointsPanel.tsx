import {
  ChevronRight,
  CircleDashed,
  Clock,
  Monitor,
  MousePointerClick,
  Route,
  Search,
  SquareTerminal,
  Zap,
} from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import {
  Button,
  Collection,
  ListLayout,
  Tree,
  TreeItem,
  TreeItemContent,
  Virtualizer,
  type Key,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import { Input } from '../input/Input';
import styles from './EntryPointsPanel.module.css';

export type EntryRowKind = 'screen' | 'element' | 'api-route' | 'cli-command';

/** One entry point (phase 8, ADR 0030), as the panel lists it. */
export interface EntryRow {
  readonly id: string;
  readonly kind: EntryRowKind;
  /** As the code names it: `/settings/profile`, `POST /api/polls`, `<button> onClick`, `web: dev`. */
  readonly label: string;
  /** Said muted beside the name: a screen's component. */
  readonly suffix?: string | null | undefined;
  /** False when part of it couldn't be worked out from the code: marked, never guessed. */
  readonly complete: boolean;
  /** Why it isn't fully detected, or a note about it (a rewrite). */
  readonly why?: string | null | undefined;
  /** A screen's elements, once loaded; a screen that has some can be opened. */
  readonly children?: readonly EntryRow[] | undefined;
  /** How many elements a screen has, before they're loaded. */
  readonly childCount?: number | undefined;
}

export type EntryGroupId = 'screens' | 'api' | 'jobs' | 'events' | 'cli';

export interface EntryGroup {
  readonly id: EntryGroupId;
  readonly count: number;
  readonly rows: readonly EntryRow[];
  /** Rows not loaded yet: a "Show more" row asks for them. */
  readonly more?: number | undefined;
  /** For a group whose kind comes later: the phase that brings it (11). */
  readonly arrivesIn?: number | null | undefined;
}

export interface EntryPointsPanelProps {
  readonly groups: readonly EntryGroup[];
  readonly filter: string;
  readonly onFilterChange: (filter: string) => void;
  /** The row whose flow is on the canvas. */
  readonly selected?: string | null | undefined;
  /** Opens a row's flow: its Show flow button, Enter, or a double click. */
  readonly onShowFlow: (row: EntryRow) => void;
  /** Loads a group's next rows. */
  readonly onShowMore?: ((group: EntryGroupId) => void) | undefined;
  /** A screen was opened: its elements are wanted. */
  readonly onExpand?: ((row: EntryRow) => void) | undefined;
  /** Said under the filter: still finding entry points, the graph not built, a failure. */
  readonly message?: ReactNode;
  /**
   * False until the entry points have been listed (the workspace not running, the graph still being built): an empty
   * group then says nothing, rather than that none were found.
   */
  readonly listed?: boolean | undefined;
  /** The filter's input, for the page's `/` shortcut. */
  readonly filterRef?: Ref<HTMLInputElement> | undefined;
  readonly className?: string | undefined;
}

/** Graphite compact rows: the virtualizer needs the height as a number. */
const ROW_HEIGHT = 28;

export const GROUP_TITLES: Readonly<Record<EntryGroupId, string>> = {
  screens: 'Screens and elements',
  api: 'API routes',
  jobs: 'Jobs and cron',
  events: 'Events',
  cli: 'CLI commands',
};

const ICONS: Readonly<Record<EntryRowKind, ReactNode>> = {
  screen: <Monitor size={14} aria-hidden />,
  element: <MousePointerClick size={14} aria-hidden />,
  'api-route': <Route size={14} aria-hidden />,
  'cli-command': <SquareTerminal size={14} aria-hidden />,
};
const GROUP_ICONS: Readonly<Record<EntryGroupId, ReactNode>> = {
  screens: <Monitor size={14} aria-hidden />,
  api: <Route size={14} aria-hidden />,
  jobs: <Clock size={14} aria-hidden />,
  events: <Zap size={14} aria-hidden />,
  cli: <SquareTerminal size={14} aria-hidden />,
};

type Item =
  | {
      readonly type: 'group';
      readonly id: string;
      readonly group: EntryGroup;
      readonly children: readonly Item[];
    }
  | {
      readonly type: 'row';
      readonly id: string;
      readonly row: EntryRow;
      readonly children: readonly Item[];
    }
  | {
      readonly type: 'more';
      readonly id: string;
      readonly group: EntryGroupId;
      readonly more: number;
      readonly children: readonly Item[];
    }
  | {
      readonly type: 'empty';
      readonly id: string;
      readonly text: string;
      readonly children: readonly Item[];
    };

// A screen whose elements aren't loaded yet has one child saying so: the tree then knows it can open.
const rowItem = (row: EntryRow): Item => ({
  type: 'row',
  id: row.id,
  row,
  children:
    row.children !== undefined
      ? row.children.map(rowItem)
      : (row.childCount ?? 0) > 0
        ? [{ type: 'empty', id: `loading:${row.id}`, text: 'Loading elements…', children: [] }]
        : [],
});

/**
 * The left panel's entry points (Figma 06; design brief §23): grouped by kind, each group with its count; each entry
 * point with its kind's icon, its name, a mark when it isn't fully detected (with why), and Show flow. A screen opens
 * to its elements. React Aria's Tree gives the WAI-ARIA tree: arrows move and open or close, Enter shows the flow.
 * Only the rows in view are in the page, so thousands of entry points stay fast.
 */
export function EntryPointsPanel({
  groups,
  filter,
  onFilterChange,
  selected,
  onShowFlow,
  onShowMore,
  onExpand,
  message,
  filterRef,
  listed = true,
  className,
}: EntryPointsPanelProps) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const items: Item[] = groups.map((group) => ({
    type: 'group',
    id: `group:${group.id}`,
    group,
    children: [
      ...group.rows.map(rowItem),
      ...((group.more ?? 0) > 0
        ? [
            {
              type: 'more' as const,
              id: `more:${group.id}`,
              group: group.id,
              more: group.more ?? 0,
              children: [],
            },
          ]
        : []),
      ...(group.rows.length === 0 && (listed || group.arrivesIn != null)
        ? [
            {
              type: 'empty' as const,
              id: `empty:${group.id}`,
              text:
                group.arrivesIn != null
                  ? `Arrives in phase ${String(group.arrivesIn)}.`
                  : filter === ''
                    ? 'None found in this project.'
                    : 'None match the filter.',
              children: [],
            },
          ]
        : []),
    ],
  }));
  const rows = new Map<string, EntryRow>();
  const visit = (list: readonly EntryRow[]) => {
    for (const row of list) {
      rows.set(row.id, row);
      visit(row.children ?? []);
    }
  };
  for (const group of groups) visit(group.rows);

  return (
    <section className={classNames(styles.panel, className)} aria-label="Entry points">
      <div className={styles.header}>
        <h2 className={styles.title}>Entry points</h2>
        {listed && <span className={styles.count}>{total}</span>}
      </div>
      <Input
        ref={filterRef}
        controlSize="sm"
        aria-label="Filter entry points"
        placeholder="Filter"
        value={filter}
        onChange={(event) => {
          onFilterChange(event.target.value);
        }}
        leading={<Search size={14} aria-hidden />}
        trailing={<kbd className={styles.kbd}>/</kbd>}
      />
      {message != null && <p className={styles.message}>{message}</p>}
      <Virtualizer layout={ListLayout} layoutOptions={{ rowSize: ROW_HEIGHT }}>
        <Tree
          aria-label="Entry points"
          className={classNames(styles.tree)}
          items={items}
          defaultExpandedKeys={groups.map((group) => `group:${group.id}`)}
          selectionMode="none"
          onExpandedChange={(keys: Set<Key>) => {
            for (const key of keys) {
              const row = rows.get(String(key));
              if (row !== undefined && row.children === undefined) onExpand?.(row);
            }
          }}
          onAction={(key) => {
            const id = String(key);
            const row = rows.get(id);
            if (row !== undefined) onShowFlow(row);
            else if (id.startsWith('more:')) onShowMore?.(id.slice('more:'.length) as EntryGroupId);
          }}
        >
          {function render(item: Item) {
            return (
              <TreeItem
                id={item.id}
                textValue={
                  item.type === 'group'
                    ? GROUP_TITLES[item.group.id]
                    : item.type === 'row'
                      ? item.row.label
                      : item.type === 'more'
                        ? `Show ${String(item.more)} more`
                        : item.text
                }
                className={classNames(styles.item)}
                data-current={item.type === 'row' && item.row.id === selected ? true : undefined}
              >
                <TreeItemContent>
                  {({ hasChildItems, isExpanded }) => (
                    <Row
                      item={item}
                      hasChildItems={hasChildItems}
                      isExpanded={isExpanded}
                      onShowFlow={onShowFlow}
                      listed={listed}
                    />
                  )}
                </TreeItemContent>
                {item.children.length > 0 && (
                  <Collection items={item.children}>{render}</Collection>
                )}
              </TreeItem>
            );
          }}
        </Tree>
      </Virtualizer>
    </section>
  );
}

function Row({
  item,
  hasChildItems,
  isExpanded,
  onShowFlow,
  listed,
}: {
  readonly item: Item;
  readonly hasChildItems: boolean;
  readonly isExpanded: boolean;
  readonly onShowFlow: (row: EntryRow) => void;
  /** Before the entry points are listed, a count isn't known: only a later kind's 0 is. */
  readonly listed: boolean;
}) {
  const chevron = hasChildItems ? (
    <Button
      slot="chevron"
      className={classNames(styles.chevron)}
      aria-label={isExpanded ? 'Close' : 'Open'}
    >
      <ChevronRight size={14} aria-hidden className={isExpanded ? styles.open : undefined} />
    </Button>
  ) : (
    <span className={styles.spacer} aria-hidden />
  );
  if (item.type === 'group') {
    return (
      <div className={classNames(styles.row, styles.groupRow)}>
        {chevron}
        <span className={styles.icon}>{GROUP_ICONS[item.group.id]}</span>
        <span className={styles.groupTitle}>{GROUP_TITLES[item.group.id]}</span>
        {(listed || item.group.arrivesIn != null) && (
          <span className={styles.groupCount}>{item.group.count}</span>
        )}
      </div>
    );
  }
  if (item.type === 'more') {
    return (
      <div className={styles.row}>
        <span className={styles.spacer} aria-hidden />
        <span className={styles.more}>Show {item.more} more</span>
      </div>
    );
  }
  if (item.type === 'empty') {
    return (
      <div className={styles.row}>
        <span className={styles.spacer} aria-hidden />
        <span className={styles.empty}>{item.text}</span>
      </div>
    );
  }
  const { row } = item;
  return (
    <div className={styles.row}>
      {chevron}
      <span className={styles.icon}>{ICONS[row.kind]}</span>
      <span className={classNames(styles.label, row.kind !== 'screen' && styles.mono)}>
        {row.label}
      </span>
      {row.suffix != null && <span className={styles.suffix}>{row.suffix}</span>}
      <span className={styles.fill} />
      {!row.complete && (
        <span
          className={styles.partial}
          role="img"
          aria-label={`Not fully detected${row.why == null ? '' : `: ${row.why}`}`}
          title={`Not fully detected${row.why == null ? '' : `: ${row.why}`}`}
        >
          <CircleDashed size={12} aria-hidden />
        </span>
      )}
      <Button
        className={classNames(styles.showFlow)}
        onPress={() => {
          onShowFlow(row);
        }}
        aria-label={`Show the flow from ${row.label}`}
      >
        Show flow
      </Button>
    </div>
  );
}
