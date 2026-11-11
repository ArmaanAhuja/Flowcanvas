import { FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Autocomplete,
  Dialog,
  Input,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  SearchField,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import { rankPaths } from './fuzzy';
import styles from './QuickOpen.module.css';

export interface QuickOpenProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Every file of the project (project-relative paths). */
  readonly files: readonly string[];
  /** A file was chosen. */
  readonly onOpen: (path: string) => void;
}

const MOST = 50;

/**
 * Open a file by typing part of its name (Ctrl/⌘+P; Figma 16's palette, files only for now). A modal dialog:
 * focus moves to the search field, arrow keys move through the results (React Aria's Autocomplete keeps focus in
 * the field), Enter opens, Escape closes and focus returns to where it was.
 */
export function QuickOpen({ isOpen, onOpenChange, files, onOpen }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => rankPaths(query, files, MOST), [query, files]);

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setQuery('');
        onOpenChange(open);
      }}
      isDismissable
      className={classNames(styles.overlay)}
    >
      <Modal className={classNames(styles.modal)}>
        <Dialog aria-label="Open a file" className={classNames(styles.dialog)}>
          <Autocomplete inputValue={query} onInputChange={setQuery}>
            <SearchField aria-label="File name" autoFocus className={classNames(styles.search)}>
              <Search size={16} className={classNames(styles.searchIcon)} aria-hidden="true" />
              <Input
                className={classNames(styles.input)}
                placeholder="Type part of a file’s name"
              />
            </SearchField>
            <ListBox
              aria-label="Files"
              items={matches.map((match) => ({ id: match.path, match }))}
              className={classNames(styles.results)}
              renderEmptyState={() => (
                <p className={classNames(styles.empty)}>
                  {files.length === 0 ? 'No files yet.' : 'No file matches.'}
                </p>
              )}
              onAction={(key) => {
                onOpen(String(key));
                setQuery('');
                onOpenChange(false);
              }}
            >
              {({ match }) => {
                const slash = match.path.lastIndexOf('/');
                const name = match.path.slice(slash + 1);
                const folder = slash === -1 ? '' : match.path.slice(0, slash);
                return (
                  <ListBoxItem
                    id={match.path}
                    textValue={match.path}
                    // Name, then folder, with a pause: not the row's text run together (phase 4).
                    aria-label={folder === '' ? name : `${name}, ${folder}`}
                    className={classNames(styles.row)}
                  >
                    <FileText size={14} className={classNames(styles.icon)} aria-hidden="true" />
                    <span className={classNames(styles.name)}>{name}</span>
                    {folder !== '' && <span className={classNames(styles.folder)}>{folder}</span>}
                  </ListBoxItem>
                );
              }}
            </ListBox>
          </Autocomplete>
          <footer className={classNames(styles.footer)} aria-hidden="true">
            <span>
              <kbd className={classNames(styles.kbd)}>↑↓</kbd> move
            </span>
            <span>
              <kbd className={classNames(styles.kbd)}>↵</kbd> open
            </span>
            <span>
              <kbd className={classNames(styles.kbd)}>esc</kbd> close
            </span>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
