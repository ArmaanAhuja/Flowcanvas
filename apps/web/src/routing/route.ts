import { useEffect, useState, type MouseEvent } from 'react';

/**
 * The app's two pages (phase 2, ADR 0020): the projects list at `/`, and a project at `/p/<id>`. Two routes
 * don't justify a routing library; this is the History API and a hook. Cloudflare and `vite preview` serve
 * index.html for any path, so a reload at /p/<id> lands here too.
 */
export type Route =
  | { readonly page: 'home' }
  | { readonly page: 'project'; readonly projectId: string }
  | { readonly page: 'not-found' };

const PROJECT = /^\/p\/([^/]+)\/?$/;

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { page: 'home' };
  const match = PROJECT.exec(pathname);
  if (match?.[1] !== undefined) {
    try {
      return { page: 'project', projectId: decodeURIComponent(match[1]) };
    } catch {
      return { page: 'not-found' };
    }
  }
  return { page: 'not-found' };
}

export const projectPath = (projectId: string) => `/p/${encodeURIComponent(projectId)}`;

const CHANGE = 'flowcanvas:navigate';

/** Goes to `path` without a reload, as a link would. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(CHANGE));
}

/** The current route, kept up to date with links, back and forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener('popstate', update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(CHANGE, update);
    };
  }, []);
  return route;
}

/**
 * Props for an in-app link: a real `href` (so it can be opened in a new tab, copied, or read by a screen
 * reader as a link), with a plain click handled here instead of reloading the page.
 */
export function linkTo(path: string) {
  return {
    href: path,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      // Let the browser handle new tabs, new windows and downloads.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      navigate(path);
    },
  };
}
