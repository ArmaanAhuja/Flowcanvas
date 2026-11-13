// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pointAlong, routePath } from './route';

describe('routePath', () => {
  it('draws a straight route as one line', () => {
    expect(
      routePath([
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ]),
    ).toBe('M 0 0 L 0 50');
  });

  it('rounds each turn, by less where a segment is short', () => {
    // Down 40, right 100, down 6: the first corner is 8 px, the second only 3 (half of the last 6 px).
    expect(
      routePath([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 100, y: 40 },
        { x: 100, y: 46 },
      ]),
    ).toBe('M 0 0 L 0 32 Q 0 40 8 40 L 97 40 Q 100 40 100 43 L 100 46');
  });

  it('draws nothing without points', () => {
    expect(routePath([])).toBe('');
  });
});

describe('pointAlong', () => {
  it('finds the point a distance along, across turns', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 50, y: 10 },
    ];
    expect(pointAlong(route, 20)).toEqual({ x: 10, y: 10 });
  });

  it('keeps to the middle of a short route', () => {
    expect(
      pointAlong(
        [
          { x: 0, y: 0 },
          { x: 0, y: 16 },
        ],
        20,
      ),
    ).toEqual({ x: 0, y: 8 });
  });
});
