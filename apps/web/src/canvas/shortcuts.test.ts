import { describe, expect, it } from 'vitest';
import { isCanvasShortcut } from './FlowCanvas';

const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key: 'f', ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

describe('canvas shortcuts (F, V, H)', () => {
  it('take a plain key pressed anywhere on the page', () => {
    expect(isCanvasShortcut(key({}))).toBe(true);
    expect(isCanvasShortcut(key({}, document.createElement('div')))).toBe(true);
  });

  it('never take a key while typing: inputs, text areas (the terminal’s too), editable text, selects', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    for (const target of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      editable,
    ]) {
      expect(isCanvasShortcut(key({}, target)), target.tagName).toBe(false);
    }
    editable.remove();
  });

  it('leave the browser’s own shortcuts alone (⌘F, Ctrl+F, Alt), and held-down repeats', () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }]) {
      expect(isCanvasShortcut(key(init)), JSON.stringify(init)).toBe(false);
    }
  });

  it('never take a key typed in the code editor, which lives in a shadow root (ADR 0021)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    host.attachShadow({ mode: 'open' }).append(editor);
    let taken: boolean | undefined;
    const listener = (event: KeyboardEvent) => {
      // What a window listener sees: the host, not the editor.
      expect(event.target).toBe(host);
      taken = isCanvasShortcut(event);
    };
    window.addEventListener('keydown', listener);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, composed: true }));
    window.removeEventListener('keydown', listener);
    host.remove();
    expect(taken).toBe(false);
  });

  it('never take a key inside a dialog, list or menu above the canvas (the palette passes keys to its list)', () => {
    for (const role of ['dialog', 'listbox', 'menu']) {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', role);
      const inner = document.createElement('div');
      overlay.append(inner);
      document.body.append(overlay);
      expect(isCanvasShortcut(key({ key: 'v' }, inner)), role).toBe(false);
      overlay.remove();
    }
  });
});
