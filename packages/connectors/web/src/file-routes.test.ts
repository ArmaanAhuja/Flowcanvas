import { describe, expect, it } from 'vitest';
import { flatRoute, nextAppRoute } from './file-routes.js';

describe('nextAppRoute', () => {
  it('names pages and route handlers by their folders', () => {
    expect(nextAppRoute('page.tsx')).toEqual({ kind: 'page', path: '/' });
    expect(nextAppRoute('settings/profile/page.tsx')).toEqual({
      kind: 'page',
      path: '/settings/profile',
    });
    expect(nextAppRoute('api/status/route.ts')).toEqual({ kind: 'route', path: '/api/status' });
  });

  it('writes parameters as :name and the rest of a path as *', () => {
    expect(nextAppRoute('poll/[urlId]/page.tsx')?.path).toBe('/poll/:urlId');
    expect(nextAppRoute('api/private/[...route]/route.ts')?.path).toBe('/api/private/*');
    expect(nextAppRoute('docs/[[...slug]]/page.mdx')?.path).toBe('/docs/*');
  });

  it('leaves out route groups and parallel slots, and isn’t fooled by private folders or intercepting routes', () => {
    expect(nextAppRoute('(admin)/[locale]/(space)/polls/page.tsx')?.path).toBe('/:locale/polls');
    expect(nextAppRoute('@modal/login/page.tsx')?.path).toBe('/login');
    expect(nextAppRoute('_components/page.tsx')).toBeNull();
    expect(nextAppRoute('feed/(.)photo/[id]/page.tsx')).toBeNull();
    expect(nextAppRoute('layout.tsx')).toBeNull();
    expect(nextAppRoute('settings/page.test.tsx')).toBeNull();
  });
});

describe('flatRoute', () => {
  it('flattens + folders and splits names on dots', () => {
    expect(flatRoute('_authenticated+/admin+/documents.$id.tsx')).toEqual({
      path: '/admin/documents/:id',
      layout: false,
    });
    expect(flatRoute('_authenticated+/admin+/_index.tsx')).toEqual({
      path: '/admin',
      layout: false,
    });
    expect(flatRoute('_index.tsx')).toEqual({ path: '/', layout: false });
  });

  it('knows layouts and pathless routes from pages', () => {
    expect(flatRoute('_authenticated+/_layout.tsx')).toEqual({ path: '/', layout: true });
    expect(flatRoute('_auth.tsx')).toEqual({ path: '/', layout: true });
    expect(flatRoute('_auth.login.tsx')).toEqual({ path: '/login', layout: false });
  });

  it('reads parameters, the rest of a path, optional segments, escapes and trailing underscores', () => {
    expect(flatRoute('files.$.tsx')?.path).toBe('/files/*');
    expect(flatRoute('($lang).about.tsx')?.path).toBe('/:lang?/about');
    expect(flatRoute('[sitemap.xml].tsx')?.path).toBe('/sitemap.xml');
    expect(flatRoute('users_.$id.edit.tsx')?.path).toBe('/users/:id/edit');
  });

  it('reads a folder route from its own file only, and skips dot files and non-scripts', () => {
    expect(flatRoute('settings/route.tsx')?.path).toBe('/settings');
    expect(flatRoute('settings/form.tsx')).toBeNull();
    expect(flatRoute('.DS_Store')).toBeNull();
    expect(flatRoute('_authenticated+/styles.css')).toBeNull();
  });
});
