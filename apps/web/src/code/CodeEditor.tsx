import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import styles from './CodeEditor.module.css';

export interface CodeEditorProps {
  /** The shown file's state. A different state (another file, or the same file reloaded) replaces the view's. */
  readonly state: EditorState;
  /** Every change of selection or text, e.g. for the status bar's cursor. */
  readonly onUpdate?: (state: EditorState) => void;
  /**
   * A place to move to (a symbol from ⌘K): the cursor goes there, it scrolls to the middle, and the editor takes
   * focus. Each `id` is applied once, so typing afterwards isn't pulled back.
   */
  readonly reveal?:
    { readonly line: number; readonly column: number; readonly id: number } | undefined;
  /**
   * TypeScript's questions about the name at the cursor (phase 5): F12 for its definition, Shift+F12 for its
   * references. 1-based line and column in UTF-16 units, as the engine counts.
   */
  readonly onSemanticKey?: (op: 'definition' | 'references', at: CodePoint) => void;
  /** A right-click: the place clicked (the cursor moves there) and where the pointer is, for the menu. */
  readonly onContextMenu?: (
    at: CodePoint,
    pointer: { readonly x: number; readonly y: number },
  ) => void;
}

/** A place in a file: 1-based line and column, in UTF-16 units. */
export interface CodePoint {
  readonly line: number;
  readonly column: number;
}

/** The 1-based line and column of an offset in the document. */
export function pointOf(state: EditorState, offset: number): CodePoint {
  const line = state.doc.lineAt(offset);
  return { line: line.number, column: offset - line.from + 1 };
}

/**
 * One CodeMirror view, in its own open shadow root (ADR 0021): there, CodeMirror's styles go into constructed
 * stylesheets, which our Content-Security-Policy allows, instead of <style> elements, which it blocks. Token
 * variables and fonts still reach inside. Switching files swaps the state, so each file keeps its own undo.
 */
export function CodeEditor({
  state,
  onUpdate,
  reveal,
  onSemanticKey,
  onContextMenu,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const semanticKey = useRef(onSemanticKey);
  semanticKey.current = onSemanticKey;
  const contextMenu = useRef(onContextMenu);
  contextMenu.current = onContextMenu;

  // Keys and right-clicks inside the shadow root reach the host element; CodeMirror says where they are.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = view.current;
      if (
        current === null ||
        event.key !== 'F12' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      if (semanticKey.current === undefined) return;
      event.preventDefault();
      semanticKey.current(
        event.shiftKey ? 'references' : 'definition',
        pointOf(current.state, current.state.selection.main.head),
      );
    };
    const onMenu = (event: MouseEvent) => {
      const current = view.current;
      if (current === null || contextMenu.current === undefined) return;
      event.preventDefault();
      const offset =
        current.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        current.state.selection.main.head;
      current.dispatch({ selection: { anchor: offset }, userEvent: 'select.pointer' });
      contextMenu.current(pointOf(current.state, offset), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('contextmenu', onMenu);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('contextmenu', onMenu);
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    // React's development mode runs effects twice: reuse the shadow root, which can only be attached once.
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    // Page CSS doesn't reach into a shadow root; this element only needs to fill it (CSSOM, allowed by our CSP).
    parent.style.height = '100%';
    root.append(parent);
    const created = new EditorView({
      state,
      parent,
      root,
      dispatchTransactions: (transactions, target) => {
        target.update(transactions);
        update.current?.(target.state);
      },
    });
    view.current = created;
    return () => {
      created.destroy();
      parent.remove();
      view.current = null;
    };
    // The view is made once; later states are swapped in below.
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current !== null && current.state !== state) {
      current.setState(state);
      update.current?.(state);
    }
  }, [state]);

  const revealed = useRef<number | undefined>(undefined);
  useEffect(() => {
    const current = view.current;
    if (current === null || reveal === undefined || revealed.current === reveal.id) return;
    revealed.current = reveal.id;
    const position = positionOf(current.state, reveal.line, reveal.column);
    current.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
      userEvent: 'select.reveal',
    });
    current.focus();
  }, [reveal, state]);

  return <div ref={host} className={styles.editor} data-region="editor" />;
}

/** Focus the editor inside a host element (its view lives in the shadow root). */
export function focusEditor(host: Element | null): void {
  const content = host?.shadowRoot?.querySelector<HTMLElement>('.cm-content');
  content?.focus();
}

/**
 * The document offset of a 1-based line and column (UTF-16 units, as the engine and CodeMirror count), kept
 * inside the document: the file may have changed since it was indexed.
 */
export function positionOf(state: EditorState, line: number, column: number): number {
  const doc = state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  return target.from + Math.min(Math.max(0, column - 1), target.length);
}
