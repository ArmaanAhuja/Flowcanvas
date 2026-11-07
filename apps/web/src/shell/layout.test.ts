import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_KEY, SIZES, loadLayout } from './Shell';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the saved shell layout', () => {
  it('starts at Figma 06’s sizes (tokens), with the dock closed', () => {
    expect(loadLayout()).toEqual({
      left: { size: 248, open: true },
      right: { size: 360, open: true },
      dock: { size: 300, open: false },
    });
    expect(SIZES.left.default).toBe(248);
  });

  it('reads back pixel sizes and open states', () => {
    const saved = {
      left: { size: 320, open: false },
      right: { size: 400, open: true },
      dock: { size: 200, open: true },
    };
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved));
    expect(loadLayout()).toEqual(saved);
  });

  it('uses the default for any entry that is out of range or malformed', () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        left: { size: 5, open: true },
        right: { size: 'wide', open: true },
        dock: { size: 200 },
      }),
    );
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('survives broken JSON and blocked storage', () => {
    window.localStorage.setItem(LAYOUT_KEY, '{not json');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
