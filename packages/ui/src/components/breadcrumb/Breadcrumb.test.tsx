import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Breadcrumb, shownSegments } from './Breadcrumb';

afterEach(cleanup);

describe('Breadcrumb', () => {
  it('shows the trail with the last segment as the current location', () => {
    render(<Breadcrumb aria-label="File path" segments={['worker', 'process.ts']} />);
    const nav = screen.getByRole('navigation', { name: 'File path' });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'worker',
      'process.ts',
    ]);
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe('process.ts');
  });

  it('cuts a long trail in the middle, never the file, and keeps the whole of it on hover', () => {
    const segments = ['apps', 'web', 'src', 'features', 'polls', 'create', 'form.tsx'];
    expect(shownSegments(segments)).toEqual(['apps', null, 'polls', 'create', 'form.tsx']);
    render(<Breadcrumb aria-label="File path" segments={segments} />);
    expect(screen.getByLabelText('3 more').textContent).toBe('…');
    expect(screen.getByRole('list').getAttribute('title')).toBe(segments.join(' / '));
    expect(shownSegments(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
