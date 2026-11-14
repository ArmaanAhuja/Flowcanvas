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

// Testing Library's findBy* and waitFor wait 1 s by default. The whole project page renders in many tests, and when
// every package's tests share the laptop's cores (`pnpm test`), a page's first answers can take longer: phase 8's
// entry points added a few requests at start, and five page tests timed out only under that load (each passed
// alone). The work is what's tested, so the wait is set for it, as the tests' own time limits are.
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });
