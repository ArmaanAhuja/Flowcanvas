// One fake control plane for the page tests (owner, 12 Nov 2026: "one shared fake workspace", as long as it changes
// nothing the tests prove). It answers the project list, then each test's own routes by the end of their path, and
// `{}` to anything else, as each test's own fake did. The walkthroughs' equivalent is e2e/try-it/fake-workspace.ts.
import { vi } from 'vitest';

/** A route's answer: a body (sent with 200), or a Response for any other status. */
export type FakeRoute = (url: URL, init?: RequestInit) => unknown;

/** A reply with a status other than 200. */
export const reply = (body: unknown, status: number): Response => Response.json(body, { status });

/** The page's API, answered as `routes` say (checked in order, by the end of the path). */
export function fakeApi(
  project: unknown,
  routes: Readonly<Record<string, FakeRoute>> = {},
): typeof fetch {
  return (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'https://flowcanvas.example',
    );
    if (url.pathname === '/api/projects') {
      return Promise.resolve(Response.json({ projects: [project], workspacesAvailable: true }));
    }
    for (const [suffix, route] of Object.entries(routes)) {
      if (url.pathname.endsWith(suffix)) {
        const said = route(url, init);
        return Promise.resolve(said instanceof Response ? said : Response.json(said));
      }
    }
    return Promise.resolve(Response.json({}));
  };
}

/** A one-file index, ready: for the tests that ask the index but aren't about it. */
export const INDEX_READY = {
  state: 'ready',
  done: 1,
  total: 1,
  files: 1,
  byStatus: { parsed: 1, 'no-grammar': 0, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: 1,
  withSyntaxErrors: 0,
  partlyRead: 0,
  lastFullMs: 10,
  message: null,
} as const;

/** jsdom has no layout: give the file tree's virtualizer and the panels a viewport. Call in beforeEach. */
export function jsdomLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(248);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  Element.prototype.scrollIntoView = () => undefined;
}
