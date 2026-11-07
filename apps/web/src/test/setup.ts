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
