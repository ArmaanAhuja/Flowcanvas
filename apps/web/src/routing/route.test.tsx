import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { linkTo, navigate, parseRoute, projectPath, useRoute } from './route';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('parseRoute', () => {
  it('knows the projects list and a project', () => {
    expect(parseRoute('/')).toEqual({ page: 'home' });
    expect(parseRoute('/p/3f1c0d2e-0000-4000-8000-000000000001')).toEqual({
      page: 'project',
      projectId: '3f1c0d2e-0000-4000-8000-000000000001',
    });
    expect(parseRoute('/p/abc/')).toEqual({ page: 'project', projectId: 'abc' });
  });

  it('says not found for anything else, including a malformed address', () => {
    for (const path of ['/p', '/p/', '/p/a/b', '/projects', '/p/%E0%A4%A']) {
      expect(parseRoute(path), path).toEqual({ page: 'not-found' });
    }
  });

  it('builds a project address that parses back to the same project', () => {
    expect(parseRoute(projectPath('a b/c'))).toEqual({ page: 'project', projectId: 'a b/c' });
  });
});

describe('navigation', () => {
  it('follows links, back and forward without reloading', async () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ page: 'home' });
    act(() => {
      navigate('/p/x');
    });
    expect(result.current).toEqual({ page: 'project', projectId: 'x' });
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => {
        window.addEventListener('popstate', resolve, { once: true });
      });
    });
    expect(result.current).toEqual({ page: 'home' });
  });

  it('a link has a real address, and a plain click stays in the app', async () => {
    render(<a {...linkTo('/p/y')}>Rallly</a>);
    const link = screen.getByRole('link', { name: 'Rallly' });
    expect(link.getAttribute('href')).toBe('/p/y');
    await userEvent.click(link);
    expect(window.location.pathname).toBe('/p/y');
  });
});
