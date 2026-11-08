import { Breadcrumb, EditorTabs, StatusBar, Toggle } from '@flowcanvas/ui';
import type { EditorState } from '@codemirror/state';
import { useState } from 'react';
import { CodeEditor } from './CodeEditor';
import { cursorLabel } from './editor-setup';
import { detectIndent, languageFor } from './languages';
import { FILES_TEXT } from './texts';
import type { CodeFiles, OpenFile } from './useCodeFiles';
import styles from './Code.module.css';

export const CODE_TEXT = {
  nothingOpen: 'Choose a file on the left to open it.',
  loading: 'Opening the file…',
  binary: 'This file isn’t text (an image, a font or similar), so it can’t be edited here.',
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  keyboard: 'In the editor, Tab indents. Press Escape, then Tab, to move on.',
  autosave: 'Autosave',
} as const;

const statusOf = (file: OpenFile): string | undefined =>
  file.save.kind === 'saving'
    ? CODE_TEXT.saving
    : file.save.kind === 'conflict' || file.save.kind === 'failed'
      ? undefined
      : file.unsaved
        ? CODE_TEXT.unsaved
        : file.save.kind === 'saved'
          ? CODE_TEXT.saved
          : undefined;

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Restored unsaved changes from 14:02." (or the date, if it wasn't today). */
export function restoredText(at: number, now: number = Date.now()): string {
  const when = new Date(at);
  const today = new Date(now).toDateString() === when.toDateString();
  const label = today
    ? clock.format(when)
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(when);
  return `Restored unsaved changes from ${label}.`;
}

/** The Code view (Figma 11), where the canvas is in the Graph view: tabs, the path, the editor, the status. */
export function CodeView({
  files,
  running,
}: {
  readonly files: CodeFiles;
  readonly running: boolean;
}) {
  const active = files.active;
  const [cursor, setCursor] = useState('Ln 1, Col 1');

  if (!running) {
    return (
      <section className={styles.code} aria-label="Code">
        <p className={styles.centred}>{FILES_TEXT.notRunning}</p>
      </section>
    );
  }

  const onUpdate = (state: EditorState) => {
    if (active === undefined) return;
    files.updated(active.path, state);
    const label = cursorLabel(state);
    if (label !== cursor) setCursor(label);
  };

  const text =
    active?.view.kind === 'text' ? (files.latest(active.path) ?? active.view.initial) : undefined;
  const status = active === undefined ? undefined : statusOf(active);

  return (
    <section className={styles.code} aria-label="Code">
      <EditorTabs
        aria-label="Open files"
        tabs={files.files.map((file) => ({
          id: file.path,
          label: file.path.split('/').pop() ?? file.path,
          title: file.path,
          unsaved: file.unsaved,
        }))}
        {...(active === undefined ? {} : { active: active.path })}
        onSelect={files.show}
        onClose={files.close}
      />
      {active === undefined ? (
        <p className={styles.centred}>{CODE_TEXT.nothingOpen}</p>
      ) : (
        <>
          <Breadcrumb aria-label="File path" segments={active.path.split('/')} />
          {active.restored !== undefined && active.save.kind !== 'conflict' && (
            <p className={styles.restored} role="status">
              {restoredText(active.restored.at)}
            </p>
          )}
          {(active.save.kind === 'conflict' || active.save.kind === 'failed') && (
            <p className={styles.problem} role="alert">
              {active.save.message}
              {active.save.kind === 'conflict' &&
                !active.save.message.endsWith('not saved.') &&
                ' Your changes are still here, not saved.'}
            </p>
          )}
          {active.view.kind === 'loading' ? (
            <p className={styles.centred} role="status">
              {CODE_TEXT.loading}
            </p>
          ) : active.view.kind === 'binary' ? (
            <p className={styles.centred}>{CODE_TEXT.binary}</p>
          ) : active.view.kind === 'refused' ? (
            <p className={styles.centred} role="alert">
              {active.view.message}
            </p>
          ) : (
            text !== undefined && <CodeEditor key={active.path} state={text} onUpdate={onUpdate} />
          )}
          <StatusBar
            aria-label="Editor status"
            aria-description={CODE_TEXT.keyboard}
            items={
              text === undefined
                ? []
                : [
                    cursor,
                    detectIndent(text.doc.sliceString(0, 20_000)).label,
                    'UTF-8',
                    languageFor(active.path).name,
                  ]
            }
            end={
              <>
                {status !== undefined && <span role="status">{status}</span>}
                <span id="autosave-label">{CODE_TEXT.autosave}</span>
                <Toggle
                  aria-labelledby="autosave-label"
                  checked={files.autosave}
                  onCheckedChange={files.setAutosave}
                />
              </>
            }
          />
        </>
      )}
    </section>
  );
}
