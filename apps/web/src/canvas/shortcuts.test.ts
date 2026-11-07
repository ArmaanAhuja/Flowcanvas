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
});
