import {
  Box,
  Component,
  FileText,
  Hash,
  Heading,
  Monitor,
  Route,
  SquareTerminal,
  ListOrdered,
  Package,
  Parentheses,
  Search,
  SquareFunction,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  Autocomplete,
  Collection,
  Dialog,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Modal,
  ModalOverlay,
  SearchField,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import { rankPaths } from '../quick-open/fuzzy';
import quickOpen from '../quick-open/QuickOpen.module.css';
import styles from './CommandPalette.module.css';
import { FILES_PREFIX, ROUTES_PREFIX } from './prefixes';

/** An entry point the palette can find (phase 8): a screen, an API route or a command. */
export interface PaletteEntry {
  readonly id: string;
  readonly kind: 'screen' | 'api-route' | 'cli-command';
  readonly name: string;
  /** Said muted beside it: a screen's component, or where it's declared. */
  readonly detail: string | null;
}

/** A symbol found by the project index (the engine's SymbolHit). */
export interface PaletteSymbol {
  readonly path: string;
  readonly name: string;
  readonly kind: PaletteSymbolKind;
  readonly container: string | null;
  readonly line: number;
  readonly column: number;
  readonly exported: boolean;
}

export type PaletteSymbolKind =
  | 'function'
  | 'component'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'namespace'
  | 'heading';

const KINDS: Readonly<Record<PaletteSymbolKind, { icon: LucideIcon; label: string }>> = {
  function: { icon: SquareFunction, label: 'Function' },
  component: { icon: Component, label: 'Component' },
  class: { icon: Box, label: 'Class' },
  method: { icon: Parentheses, label: 'Method' },
  interface: { icon: Type, label: 'Interface' },
  type: { icon: Type, label: 'Type' },
  enum: { icon: ListOrdered, label: 'Enum' },
  constant: { icon: Hash, label: 'Constant' },
  namespace: { icon: Package, label: 'Namespace' },
  heading: { icon: Heading, label: 'Heading' },
};

export interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** What's typed; the page searches symbols with it, so it's controlled. */
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** The project index's matches for `query`, best first (the page asks the engine). */
  readonly symbols: readonly PaletteSymbol[];
  /**
   * A line under Symbols about the index, when there's something to say: "Indexing 400 of 1,958 files…",
   * or why symbols aren't available. Results so far are still shown.
   */
  readonly symbolsNote?: string | undefined;
  /** Every file of the project (project-relative paths), ranked here as you type. */
  readonly files: readonly string[];
  readonly onOpenFile: (path: string) => void;
  readonly onOpenSymbol: (symbol: PaletteSymbol) => void;
  /** Opens a function's flow (phase 7): offered for the matching functions, methods and components. */
  readonly onShowFlow?: ((symbol: PaletteSymbol) => void) | undefined;
  /** The project's entry points (phase 8), matched here as you type; `/` searches only them. */
  readonly entryPoints?: readonly PaletteEntry[] | undefined;
  /** Opens the flow from an entry point. */
  readonly onShowEntry?: ((entry: PaletteEntry) => void) | undefined;
}

/** Entry points offered at once, or with `/`. */
const MOST_ENTRIES = 6;
const MOST_ENTRIES_ONLY = 30;
const ENTRY_ICONS = { screen: Monitor, 'api-route': Route, 'cli-command': SquareTerminal } as const;
const ENTRY_LABELS = {
  screen: 'Screen',
  'api-route': 'API route',
  'cli-command': 'Command',
} as const;

/** Flows offered at once: the best few matches that have one. */
const MOST_FLOWS = 5;
const HAS_FLOW: ReadonlySet<PaletteSymbolKind> = new Set(['function', 'method', 'component']);

const MOST_FILES = 20;
const TOP_HINT_ID = 'command-palette-top-hint';

type Row =
  | { readonly id: string; readonly type: 'symbol'; readonly symbol: PaletteSymbol }
  | { readonly id: string; readonly type: 'flow'; readonly symbol: PaletteSymbol }
  | { readonly id: string; readonly type: 'file'; readonly path: string }
  | { readonly id: string; readonly type: 'entry'; readonly entry: PaletteEntry };

const symbolId = (s: PaletteSymbol) => `symbol:${s.path}:${String(s.line)}:${String(s.column)}`;

/** Keys that move through the results: after one, the person's own choice is what Enter opens. */
const MOVES = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']);

/**
 * The command palette (⌘K; Figma 16, design brief §22). Phase 4 has two groups: Symbols from the project index,
 * first, and Files; `#` searches files only. A modal dialog: focus moves to the search field, Escape closes and
 * focus returns to where it was.
 *
 * **Enter opens the top result** (the Try it: "⌘K, a function's name, Enter"). The top result is marked as such
 * and opened by the palette itself until the person moves with the arrow keys; from then on, React Aria's own
 * highlight (virtual focus) is what Enter opens. React Aria's automatic first-row highlight is off: it marks the
 * row that's first when a letter is typed and keeps it, so when the symbols arrived later than half a second,
 * it stayed on a file and Enter opened that (found by CI, phase 4 step 6).
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
  query,
  onQueryChange,
  symbols,
  symbolsNote,
  files,
  onOpenFile,
  onOpenSymbol,
  onShowFlow,
  entryPoints = [],
  onShowEntry,
}: CommandPaletteProps) {
  const filesOnly = query.startsWith(FILES_PREFIX);
  const entriesOnly = onShowEntry !== undefined && query.startsWith(ROUTES_PREFIX);
  // Matched as typed (a route's `/` included), those starting with it first.
  const entryRows = useMemo<Row[]>(() => {
    const words = query.trim().toLowerCase();
    if (onShowEntry === undefined || filesOnly || words === '' || words === ROUTES_PREFIX)
      return [];
    const found = entryPoints.filter((e) => e.name.toLowerCase().includes(words));
    const starts = (e: PaletteEntry) =>
      e.name.toLowerCase().startsWith(words) || e.name.toLowerCase().includes(` ${words}`) ? 0 : 1;
    found.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
    return found
      .slice(0, entriesOnly ? MOST_ENTRIES_ONLY : MOST_ENTRIES)
      .map((entry) => ({ id: `entry:${entry.id}`, type: 'entry', entry }) as const);
  }, [query, entryPoints, onShowEntry, filesOnly, entriesOnly]);
  const fileQuery = (filesOnly ? query.slice(FILES_PREFIX.length) : query).trim();
  const fileRows = useMemo<Row[]>(
    () =>
      fileQuery === '' || entriesOnly
        ? []
        : rankPaths(fileQuery, files, MOST_FILES).map((match) => ({
            id: `file:${match.path}`,
            type: 'file',
            path: match.path,
          })),
    [fileQuery, files, entriesOnly],
  );
  const symbolRows = useMemo<Row[]>(() => {
    if (filesOnly || entriesOnly || query.trim() === '') return [];
    // One row per place: the same name at the same position can't appear twice.
    const seen = new Set<string>();
    return symbols.flatMap((symbol) => {
      const id = symbolId(symbol);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, type: 'symbol', symbol } as const];
    });
  }, [filesOnly, entriesOnly, query, symbols]);
  const showSymbols = !filesOnly && !entriesOnly && query.trim() !== '';
  const flowRows: Row[] = useMemo(
    () =>
      onShowFlow === undefined
        ? []
        : symbolRows
            .filter(
              (row): row is Extract<Row, { type: 'symbol' }> =>
                row.type === 'symbol' && HAS_FLOW.has(row.symbol.kind),
            )
            .slice(0, MOST_FLOWS)
            .map((row) => ({ id: `flow:${row.id}`, type: 'flow', symbol: row.symbol }) as const),
    [onShowFlow, symbolRows],
  );
  const byId = useMemo(
    () =>
      new Map([...symbolRows, ...entryRows, ...flowRows, ...fileRows].map((row) => [row.id, row])),
    [symbolRows, entryRows, flowRows, fileRows],
  );
  // Whether the person has moved through the results since they last typed.
  const [moved, setMoved] = useState(false);
  const top = moved
    ? undefined
    : entriesOnly
      ? entryRows[0]
      : (symbolRows[0] ?? entryRows[0] ?? fileRows[0]);

  const close = () => {
    onQueryChange('');
    onOpenChange(false);
  };
  const open = (row: Row) => {
    if (row.type === 'symbol') onOpenSymbol(row.symbol);
    else if (row.type === 'flow') onShowFlow?.(row.symbol);
    else if (row.type === 'entry') onShowEntry?.(row.entry);
    else onOpenFile(row.path);
    close();
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onQueryChange('');
        onOpenChange(open);
      }}
      isDismissable
      className={classNames(quickOpen.overlay)}
    >
      <Modal className={classNames(quickOpen.modal)}>
        <Dialog aria-label="Command palette" className={classNames(quickOpen.dialog)}>
          <Autocomplete
            inputValue={query}
            onInputChange={(value) => {
              setMoved(false);
              onQueryChange(value);
            }}
            disableAutoFocusFirst
          >
            {/* Keys reach this wrapper before React Aria's own handlers (display: contents: no box of its own). */}
            <div
              className={classNames(styles.keys)}
              onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
                if (MOVES.has(event.key)) setMoved(true);
                else if (event.key === 'Enter' && top !== undefined) {
                  // Before React Aria sees it: nothing of its own is highlighted yet.
                  event.preventDefault();
                  event.stopPropagation();
                  open(top);
                }
              }}
            >
              <SearchField
                aria-label="Search symbols and files"
                aria-describedby={TOP_HINT_ID}
                autoFocus
                className={classNames(quickOpen.search)}
              >
                <Search size={16} className={classNames(quickOpen.searchIcon)} aria-hidden="true" />
                <Input
                  className={classNames(quickOpen.input)}
                  placeholder="Search symbols and files"
                />
              </SearchField>
            </div>
            {showSymbols && symbolsNote !== undefined && (
              // Outside the list: a listbox may hold only options and groups.
              <p className={classNames(styles.note)} role="status">
                {symbolsNote}
              </p>
            )}
            <ListBox
              aria-label="Results"
              className={classNames(quickOpen.results)}
              renderEmptyState={() => (
                <p className={classNames(quickOpen.empty)}>
                  {query.trim() === '' ||
                  (filesOnly && fileQuery === '') ||
                  query.trim() === ROUTES_PREFIX
                    ? filesOnly
                      ? 'Type part of a file’s name.'
                      : entriesOnly
                        ? 'Type part of a route, screen or command.'
                        : 'Type part of a function, component or file name.'
                    : 'Nothing matches.'}
                </p>
              )}
              onAction={(key) => {
                const row = byId.get(String(key));
                if (row !== undefined) open(row);
              }}
            >
              {symbolRows.length > 0 && (
                <ListBoxSection id="symbols" className={classNames(styles.section)}>
                  <Header className={classNames(styles.header)}>Symbols</Header>
                  <Collection items={symbolRows} dependencies={[top?.id]}>
                    {(row) =>
                      row.type === 'symbol' ? (
                        <SymbolRow symbol={row.symbol} isTop={row.id === top?.id} />
                      ) : null
                    }
                  </Collection>
                </ListBoxSection>
              )}
              {entryRows.length > 0 && (
                <ListBoxSection id="entry-points" className={classNames(styles.section)}>
                  <Header className={classNames(styles.header)}>Entry points</Header>
                  <Collection items={entryRows} dependencies={[top?.id]}>
                    {(row) =>
                      row.type === 'entry' ? (
                        <EntryRow entry={row.entry} isTop={row.id === top?.id} />
                      ) : null
                    }
                  </Collection>
                </ListBoxSection>
              )}
              {flowRows.length > 0 && (
                <ListBoxSection id="flows" className={classNames(styles.section)}>
                  <Header className={classNames(styles.header)}>Flows</Header>
                  <Collection items={flowRows}>
                    {(row) => (row.type === 'flow' ? <FlowRow symbol={row.symbol} /> : null)}
                  </Collection>
                </ListBoxSection>
              )}
              {fileRows.length > 0 && (
                <ListBoxSection id="files" className={classNames(styles.section)}>
                  <Header className={classNames(styles.header)}>Files</Header>
                  <Collection items={fileRows} dependencies={[top?.id]}>
                    {(row) =>
                      row.type === 'file' ? (
                        <FileRow path={row.path} isTop={row.id === top?.id} />
                      ) : null
                    }
                  </Collection>
                </ListBoxSection>
              )}
            </ListBox>
          </Autocomplete>
          <p id={TOP_HINT_ID} className={classNames(styles.hidden)}>
            Enter opens the top result.
          </p>
          <footer className={classNames(quickOpen.footer)} aria-hidden="true">
            <span>
              <kbd className={classNames(quickOpen.kbd)}>↑↓</kbd> move
            </span>
            <span>
              <kbd className={classNames(quickOpen.kbd)}>↵</kbd> open
            </span>
            <span>
              <kbd className={classNames(quickOpen.kbd)}>#</kbd> files only
            </span>
            {onShowEntry !== undefined && (
              <span>
                <kbd className={classNames(quickOpen.kbd)}>/</kbd> routes
              </span>
            )}
            <span>
              <kbd className={classNames(quickOpen.kbd)}>esc</kbd> close
            </span>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function SymbolRow({ symbol, isTop }: { readonly symbol: PaletteSymbol; readonly isTop: boolean }) {
  const { icon: Icon, label } = KINDS[symbol.kind];
  const where = `${symbol.path}:${String(symbol.line)}`;
  const detail = symbol.container === null ? where : `${symbol.container} · ${where}`;
  return (
    <ListBoxItem
      id={symbolId(symbol)}
      textValue={symbol.name}
      // The accessible name: what it is and where, with pauses, rather than the row's text run together.
      aria-label={`${symbol.name}, ${label.toLowerCase()}, ${detail}`}
      className={classNames(quickOpen.row, isTop && styles.top)}
    >
      <Icon size={14} className={classNames(quickOpen.icon)} aria-hidden="true" />
      <span className={classNames(quickOpen.name)}>{symbol.name}</span>
      <span className={classNames(styles.kind)}>{label}</span>
      <span className={classNames(quickOpen.folder, styles.place)}>{detail}</span>
    </ListBoxItem>
  );
}

function EntryRow({ entry, isTop }: { readonly entry: PaletteEntry; readonly isTop: boolean }) {
  const Icon = ENTRY_ICONS[entry.kind];
  const label = ENTRY_LABELS[entry.kind];
  return (
    <ListBoxItem
      id={`entry:${entry.id}`}
      textValue={entry.name}
      aria-label={`Show the flow from ${entry.name}, ${label.toLowerCase()}${entry.detail === null ? '' : `, ${entry.detail}`}`}
      className={classNames(quickOpen.row, isTop && styles.top)}
    >
      <Icon size={14} className={classNames(quickOpen.icon)} aria-hidden="true" />
      <span className={classNames(quickOpen.name, entry.kind !== 'screen' && styles.mono)}>
        {entry.name}
      </span>
      <span className={classNames(styles.kind)}>{label}</span>
      {entry.detail !== null && (
        <span className={classNames(quickOpen.folder, styles.place)}>{entry.detail}</span>
      )}
    </ListBoxItem>
  );
}

function FlowRow({ symbol }: { readonly symbol: PaletteSymbol }) {
  const where = `${symbol.path}:${String(symbol.line)}`;
  return (
    <ListBoxItem
      id={`flow:${symbolId(symbol)}`}
      textValue={`Show flow ${symbol.name}`}
      aria-label={`Show the flow from ${symbol.name}, ${where}`}
      className={classNames(quickOpen.row)}
    >
      <Workflow size={14} className={classNames(quickOpen.icon)} aria-hidden="true" />
      <span className={classNames(quickOpen.name)}>Show flow</span>
      <span className={classNames(styles.kind)}>{symbol.name}</span>
      <span className={classNames(quickOpen.folder, styles.place)}>{where}</span>
    </ListBoxItem>
  );
}

function FileRow({ path, isTop }: { readonly path: string; readonly isTop: boolean }) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const folder = slash === -1 ? '' : path.slice(0, slash);
  return (
    <ListBoxItem
      id={`file:${path}`}
      textValue={path}
      aria-label={folder === '' ? name : `${name}, ${folder}`}
      className={classNames(quickOpen.row, isTop && styles.top)}
    >
      <FileText size={14} className={classNames(quickOpen.icon)} aria-hidden="true" />
      <span className={classNames(quickOpen.name)}>{name}</span>
      {folder !== '' && (
        <span className={classNames(quickOpen.folder, styles.place)}>{folder}</span>
      )}
    </ListBoxItem>
  );
}
