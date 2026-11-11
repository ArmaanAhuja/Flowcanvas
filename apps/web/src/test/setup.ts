// Runs before every web test (vite.config.ts). jsdom has no ResizeObserver, which the shell's panels
// (react-resizable-panels) need to start. This one never reports sizes: real layout is tested in the browser
// (e2e/try-it/phase-2.spec.ts), not here.
class NoResizeObserver {
  observe(): void {
    // jsdom does no layout, so there is nothing to observe.
  }
  unobserve(): void {
    // As above.
  }
  disconnect(): void {
    // As above.
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoResizeObserver;
}

// jsdom has no Range geometry, which CodeMirror reads when it measures the cursor and selection. Without it, the
// Code view's tests log TypeErrors from CodeMirror's measuring (they fail nothing, but would hide a real error).
// Empty geometry, as for a page that isn't laid out; real layout is tested in the browser (the walkthroughs).
const emptyRects = (): DOMRectList => {
  const list: DOMRect[] = [];
  return Object.assign(list, { item: (index: number) => list[index] ?? null });
};
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

// jsdom has no document.execCommand, which CodeMirror calls when it takes focus (phase 4: a symbol from ⌘K
// focuses the editor). It does nothing in a page that isn't laid out; the walkthroughs focus for real.
if (typeof document !== 'undefined' && !('execCommand' in document)) {
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
}
