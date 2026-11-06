// The shim's bookkeeping. jsdom has constructed stylesheets but not document.adoptedStyleSheets, so the
// tests give the document one; whether a real browser applies the styles under the CSP is the walkthrough's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STYLE_MARK,
  adoptInjectedStyles,
  styleFreeDocument,
  withoutInlineStyles,
} from './adopt-styles';

let root: HTMLElement;
const texts = () =>
  document.adoptedStyleSheets.map((sheet) =>
    [...sheet.cssRules].map((rule) => rule.cssText.replace(/\s+/g, '')).join(''),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  Object.defineProperty(document, 'adoptedStyleSheets', {
    value: [],
    writable: true,
    configurable: true,
  });
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
});

describe('adoptInjectedStyles', () => {
  it('copies <style> elements that are there already, and ones added later, deep inside too', async () => {
    const early = document.createElement('style');
    early.textContent = '.a { color: red; }';
    root.append(early);
    const stop = adoptInjectedStyles(root);
    expect(texts()).toEqual(['.a{color:red;}']);
    const nested = document.createElement('div');
    const late = document.createElement('style');
    late.textContent = '.b { display: block; }';
    nested.append(late);
    root.append(nested);
    await settle();
    expect(texts()).toEqual(['.a{color:red;}', '.b{display:block;}']);
    stop();
  });

  it('follows xterm rewriting a style, and drops it when removed', async () => {
    const stop = adoptInjectedStyles(root);
    const style = document.createElement('style');
    root.append(style);
    style.textContent = '.c { width: 1px; }';
    await settle();
    expect(texts()).toEqual(['.c{width:1px;}']);
    style.textContent = '.c { width: 2px; }';
    await settle();
    expect(texts()).toEqual(['.c{width:2px;}']);
    style.remove();
    await settle();
    expect(texts()).toEqual([]);
    stop();
  });

  it('removes its sheets and stops watching when stopped, leaving others alone', async () => {
    const other = new CSSStyleSheet();
    document.adoptedStyleSheets = [other];
    const stop = adoptInjectedStyles(root);
    const style = document.createElement('style');
    style.textContent = '.d { margin: 0; }';
    root.append(style);
    await settle();
    expect(document.adoptedStyleSheets).toHaveLength(2);
    stop();
    expect(document.adoptedStyleSheets).toEqual([other]);
    const after = document.createElement('style');
    after.textContent = '.e { margin: 0; }';
    root.append(after);
    await settle();
    expect(document.adoptedStyleSheets).toEqual([other]);
  });

  it('does nothing where constructed stylesheets are missing', () => {
    delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    const style = document.createElement('style');
    style.textContent = '.f { margin: 0; }';
    root.append(style);
    expect(() => {
      adoptInjectedStyles(root)();
    }).not.toThrow();
  });
});

describe('styleFreeDocument', () => {
  it('hands out an inert, marked template instead of a <style>', () => {
    const standIn = styleFreeDocument();
    const element = standIn.createElement('style');
    expect(element.tagName).toBe('TEMPLATE');
    expect(element.hasAttribute(STYLE_MARK)).toBe(true);
    expect(standIn.createElement('STYLE').tagName).toBe('TEMPLATE');
  });

  it('is the real document for everything else', () => {
    const standIn = styleFreeDocument();
    expect(standIn.createElement('div').tagName).toBe('DIV');
    expect(standIn instanceof Document).toBe(true);
    expect(standIn.body).toBe(document.body);
    expect(standIn.activeElement).toBe(document.activeElement);
    expect(standIn.getElementById('nothing-here')).toBeNull();
  });

  it('feeds the shim: what xterm writes into the template becomes a stylesheet', async () => {
    const stop = adoptInjectedStyles(root);
    const element = styleFreeDocument().createElement('style');
    root.append(element);
    element.textContent = '.xterm-rows { line-height: 18px; }';
    await settle();
    expect(texts()).toEqual(['.xterm-rows{line-height:18px;}']);
    element.remove();
    await settle();
    expect(texts()).toEqual([]);
    stop();
  });
});

describe('withoutInlineStyles', () => {
  it('makes templates instead of <style> elements during the call only, and returns its result', () => {
    const made = withoutInlineStyles(() => document.createElement('style'));
    expect(made.tagName).toBe('TEMPLATE');
    expect(made.hasAttribute(STYLE_MARK)).toBe(true);
    expect(document.createElement('style').tagName).toBe('STYLE');
    expect(Object.prototype.hasOwnProperty.call(document, 'createElement')).toBe(false);
  });

  it('puts createElement back even when the call throws', () => {
    expect(() =>
      withoutInlineStyles(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(document.createElement('style').tagName).toBe('STYLE');
  });
});
