import {
  Box,
  Component,
  FileText,
  Hash,
  Heading,
  ListOrdered,
  Package,
  Parentheses,
  Search,
  SquareFunction,
  Type,
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
import { FILES_PREFIX } from './prefixes';

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
}

const MOST_FILES = 20;
const TOP_HINT_ID = 'command-palette-top-hint';

type Row =
  | { readonly id: string; readonly type: 'symbol'; readonly symbol: PaletteSymbol }
  | { readonly id: string; readonly type: 'file'; readonly path: string };

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
}: CommandPaletteProps) {
  const filesOnly = query.startsWith(FILES_PREFIX);
  const fileQuery = (filesOnly ? query.slice(FILES_PREFIX.length) : query).trim();
  const fileRows = useMemo<Row[]>(
    () =>
      fileQuery === ''
        ? []
        : rankPaths(fileQuery, files, MOST_FILES).map((match) => ({
            id: `file:${match.path}`,
            type: 'file',
            path: match.path,
          })),
    [fileQuery, files],
  );
  const symbolRows = useMemo<Row[]>(() => {
    if (filesOnly || query.trim() === '') return [];
    // One row per place: the same name at the same position can't appear twice.
    const seen = new Set<string>();
    return symbols.flatMap((symbol) => {
      const id = symbolId(symbol);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ id, type: 'symbol', symbol } as const];
    });
  }, [filesOnly, query, symbols]);
  const showSymbols = !filesOnly && query.trim() !== '';
  const byId = useMemo(
    () => new Map([...symbolRows, ...fileRows].map((row) => [row.id, row])),
    [symbolRows, fileRows],
  );
  // Whether the person has moved through the results since they last typed.
  const [moved, setMoved] = useState(false);
  const top = moved ? undefined : (symbolRows[0] ?? fileRows[0]);

  const close = () => {
    onQueryChange('');
    onOpenChange(false);
  };
  const open = (row: Row) => {
    if (row.type === 'symbol') onOpenSymbol(row.symbol);
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
                  {query.trim() === '' || (filesOnly && fileQuery === '')
                    ? filesOnly
                      ? 'Type part of a file’s name.'
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
