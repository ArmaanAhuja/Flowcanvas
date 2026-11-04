/**
 * xterm.js writes some of its styles into `<style>` elements, which our Content-Security-Policy
 * (`style-src 'self'`) rightly blocks, with a violation for each. Instead (ADR 0017):
 * 1. `styleFreeDocument()` is the document xterm is given (its `documentOverride` option). Asked for a
 *    `<style>`, it hands back an inert `<template>` element marked `data-xterm-style`, so no inline style
 *    ever reaches the page. Everything else goes to the real document.
 * 2. `adoptInjectedStyles()` copies each marked element's text into a constructed stylesheet on the
 *    document, and keeps it in step as xterm rewrites it.
 *
 * xterm 6.0.0's scroll area ignores `documentOverride` (its `this._document ?? typeof window … ? window.document
 * : null` always picks `window.document`), so `withoutInlineStyles()` gives the real document the same
 * `createElement` for the one synchronous call that makes it, `terminal.open()`.
 *
 * The CSP stays as strict as it is: only our own scripts can construct a stylesheet, and `script-src 'self'`
 * already limits scripts to ours.
 */

export const STYLE_MARK = 'data-xterm-style';

/** `createElement`, except that a `<style>` comes back as an inert, marked `<template>`. */
function styleFreeCreateElement(target: Document) {
  // The prototype's method, called with the real document as `this` (never a replaced own property).
  const prototype: {
    createElement(this: Document, tagName: string, options?: ElementCreationOptions): HTMLElement;
  } = Document.prototype;
  const create = (tagName: string, options?: ElementCreationOptions) =>
    prototype.createElement.call(target, tagName, options);
  return (tagName: string, options?: ElementCreationOptions): HTMLElement => {
    if (tagName.toLowerCase() !== 'style') return create(tagName, options);
    const inert = create('template');
    inert.setAttribute(STYLE_MARK, '');
    return inert;
  };
}

/** The real document, except that `createElement('style')` makes an inert, marked `<template>`. */
export function styleFreeDocument(real: Document = document): Document {
  return new Proxy(real, {
    get(target, property) {
      if (property === 'createElement') return styleFreeCreateElement(target);
      // Read from the real document, so its getters and methods run with the real `this`.
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * Runs `action` (synchronous: nothing else can run meanwhile) with the real document's `createElement` making
 * inert templates instead of `<style>` elements, then puts it back.
 */
export function withoutInlineStyles<T>(action: () => T, real: Document = document): T {
  const own = Object.getOwnPropertyDescriptor(real, 'createElement');
  Object.defineProperty(real, 'createElement', {
    value: styleFreeCreateElement(real),
    configurable: true,
    writable: true,
  });
  try {
    return action();
  } finally {
    if (own === undefined) delete (real as { createElement?: unknown }).createElement;
    else Object.defineProperty(real, 'createElement', own);
  }
}

const isStyleSource = (node: Node | null): node is HTMLElement =>
  node instanceof HTMLElement &&
  (node instanceof HTMLStyleElement || node.hasAttribute(STYLE_MARK));

/** Returns a function that stops watching and removes the copied sheets. */
export function adoptInjectedStyles(root: HTMLElement): () => void {
  // Every current browser has constructed stylesheets; without them, xterm just goes without these styles.
  if (!Array.isArray(document.adoptedStyleSheets)) return () => undefined;
  const sheets = new Map<HTMLElement, CSSStyleSheet>();

  function sync(element: HTMLElement): void {
    let sheet = sheets.get(element);
    if (sheet === undefined) {
      sheet = new CSSStyleSheet();
      sheets.set(element, sheet);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(element.textContent);
  }

  function drop(element: HTMLElement): void {
    const sheet = sheets.get(element);
    if (sheet === undefined) return;
    sheets.delete(element);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  }

  const sourceOf = (node: Node | null): HTMLElement | undefined => {
    if (isStyleSource(node)) return node;
    return isStyleSource(node?.parentNode ?? null) ? (node?.parentNode as HTMLElement) : undefined;
  };
  const within = (node: Node, each: (element: HTMLElement) => void) => {
    if (isStyleSource(node)) each(node);
    else if (node instanceof Element) {
      node.querySelectorAll<HTMLElement>(`style, [${STYLE_MARK}]`).forEach(each);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Text set or changed inside a source, or nodes added or removed.
      const changed = sourceOf(record.target);
      if (changed?.isConnected === true) sync(changed);
      for (const node of record.addedNodes) within(node, sync);
      for (const node of record.removedNodes) within(node, drop);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  within(root, sync);

  return () => {
    observer.disconnect();
    for (const element of [...sheets.keys()]) drop(element);
  };
}
