// CodeMirror for Flowcanvas (phase 3, ADR 0021): each file's EditorState (its text, selection and undo history),
// and how it looks, all from our tokens through CSS variables, so both themes work with no editor code.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { detectIndent, languageFor } from './languages';

/** What the editor asks of the page; one object per file, so a stale editor never saves another file. */
export interface EditorActions {
  /** Ctrl/⌘+S. */
  save(): void;
}

const mono = {
  fontFamily: 'var(--text-mono-font-family)',
  fontSize: 'var(--text-mono-font-size)',
  lineHeight: 'var(--text-mono-line-height)',
} as const;

/** Every colour and size from a token. */
export const flowcanvasTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--color-syntax-plain)',
    backgroundColor: 'var(--color-surface-canvas)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { ...mono },
  '.cm-content': { padding: 'var(--space-4) 0', caretColor: 'var(--color-text-primary)' },
  '.cm-line': { padding: '0 var(--space-16) 0 var(--space-12)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text-primary)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--color-accent-tint)' },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-panel)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-canvas)',
    color: 'var(--color-text-muted)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-4) 0 var(--space-12)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-surface-panel)',
    color: 'var(--color-text-secondary)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-surface-selected)',
    outline: 'var(--border-width-default) solid var(--color-border-strong)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-surface-selected)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--color-state-modified-tint)',
    outline: 'var(--border-width-default) solid var(--color-state-modified-solid)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--color-accent-tint)' },
  // The search panel (Ctrl/⌘+F), in our controls' look.
  '.cm-panels': {
    backgroundColor: 'var(--color-surface-panel)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--text-small-font-family)',
    fontSize: 'var(--text-small-font-size)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: 'var(--border-width-default) solid var(--color-border-subtle)',
  },
  '.cm-panel.cm-search': { padding: 'var(--space-8) var(--space-12)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    font: 'inherit',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-raised)',
    border: 'var(--border-width-default) solid var(--color-border-control)',
    borderRadius: 'var(--radius-control)',
    padding: '0 var(--space-8)',
    minHeight: 'var(--size-control-sm)',
    margin: '0 var(--space-4) 0 0',
    backgroundImage: 'none',
  },
  '.cm-panel.cm-search input:focus-visible, .cm-panel.cm-search button:focus-visible': {
    outline: 'var(--border-width-focus) solid var(--color-accent-solid)',
    outlineOffset: 'var(--space-2)',
  },
  '.cm-panel.cm-search label': {
    color: 'var(--color-text-secondary)',
    margin: '0 var(--space-8) 0 0',
  },
  '.cm-panel.cm-search [name=close]': { color: 'var(--color-text-secondary)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface-raised)',
    color: 'var(--color-text-primary)',
    border: 'var(--border-width-default) solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-popover)',
  },
});

/** Code colours (the syntax tokens; owner question on the palette, 8 Nov 2026). Everything else is plain. */
export const flowcanvasHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword],
    color: 'var(--color-syntax-keyword)',
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
    color: 'var(--color-syntax-string)',
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-syntax-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--color-syntax-comment)',
  },
  { tag: tags.heading, fontWeight: 'var(--font-weight-semibold)' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.invalid, textDecoration: 'underline wavy var(--color-state-removed-solid)' },
]);

/** A file's editor state: its text, language, indentation, undo history and keys. The language's parser loads
 * on demand, so this waits for it. */
export async function fileState(
  path: string,
  text: string,
  actions: EditorActions,
): Promise<EditorState> {
  const indent = detectIndent(text);
  const language = await languageFor(path).load();
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    highlightSelectionMatches(),
    indentUnit.of(indent.unit),
    EditorState.tabSize.of(indent.unit === '\t' ? 4 : indent.unit.length),
    language,
    syntaxHighlighting(flowcanvasHighlight),
    flowcanvasTheme,
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          actions.save();
          return true;
        },
      },
      indentWithTab,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({ 'aria-label': `Code: ${path}` }),
  ];
  return EditorState.create({ doc: text, extensions });
}

/** "Ln 43, Col 17" for the main cursor. */
export function cursorLabel(state: EditorState): string {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return `Ln ${String(line.number)}, Col ${String(head - line.from + 1)}`;
}
