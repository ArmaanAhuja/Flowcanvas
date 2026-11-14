import { describe, expect, it } from 'vitest';
import { flatRouteEntries, nextRouteEntries } from './route-files.js';
import { programOf } from './test-program.js';

describe('nextRouteEntries', () => {
  it('makes a page’s default export its screen, and a route handler’s methods its API routes', () => {
    const file = programOf({
      '/page.tsx': 'export default function PollPage() {\n  return null;\n}\n',
      '/route.ts': [
        'export async function GET() {}',
        'export const POST = async () => {};',
        'export const dynamic = "force-dynamic";',
      ].join('\n'),
    });
    expect(
      nextRouteEntries(file('/page.tsx'), { kind: 'page', path: '/poll/:urlId' }).map((e) => [
        e.kind,
        e.name,
        e.at.line,
        e.handler !== undefined,
      ]),
    ).toEqual([['screen', '/poll/:urlId', 1, true]]);
    expect(
      nextRouteEntries(file('/route.ts'), { kind: 'route', path: '/api/status' }).map((e) => [
        e.name,
        e.at.line,
      ]),
    ).toEqual([
      ['GET /api/status', 1],
      ['POST /api/status', 2],
    ]);
  });

  it('keeps a method handed to something else as a route without a handler of its own', () => {
    const file = programOf({
      '/route.ts':
        'declare const handle: any; declare const app: any;\nexport const GET = handle(app);\n',
    });
    const [get] = nextRouteEntries(file('/route.ts'), { kind: 'route', path: '/api/private/*' });
    expect(get?.name).toBe('GET /api/private/*');
    expect(get?.handler).toBeUndefined();
  });
});

describe('flatRouteEntries', () => {
  it('makes a route’s component its screen, and its loader and action server entry points', () => {
    const file = programOf({
      '/profile.tsx': [
        'export async function loader() {}',
        'export const action = async () => {};',
        'function SettingsProfile() {\n  return null;\n}',
        'export default SettingsProfile;',
      ].join('\n'),
    });
    expect(
      flatRouteEntries(file('/profile.tsx'), { path: '/settings/profile', layout: false }).map(
        (e) => [e.kind, e.name, e.at.line, e.handler !== undefined],
      ),
    ).toEqual([
      ['screen', '/settings/profile', 6, true],
      ['api-route', 'loader /settings/profile', 1, true],
      ['api-route', 'action /settings/profile', 2, true],
    ]);
  });

  it('names a handler declared elsewhere, and says why one made at run time has none', () => {
    const file = programOf({
      '/page.tsx': "import DocumentPage from './document-page';\nexport default DocumentPage;\n",
      '/theme.tsx':
        'declare const createThemeAction: any;\nexport const action = createThemeAction(1);\n',
    });
    const [page] = flatRouteEntries(file('/page.tsx'), { path: '/documents', layout: false });
    expect(page?.handler).toBeUndefined();
    const text = file('/page.tsx').source.text;
    const at = text.lastIndexOf('DocumentPage');
    expect(page?.handlerName).toEqual({ start: at, end: at + 'DocumentPage'.length });
    const [action] = flatRouteEntries(file('/theme.tsx'), { path: '/api/theme', layout: false });
    expect([action?.name, action?.handler, action?.handlerName, action?.why]).toEqual([
      'action /api/theme',
      undefined,
      undefined,
      'Its handler is made when the app runs, not written as a function here.',
    ]);
  });

  it('gives a layout no screen, a resource route only its loader, and reads `export { … as default }`', () => {
    const file = programOf({
      '/_layout.tsx':
        'export default function Layout() {\n  return null;\n}\nexport function loader() {}\n',
      '/health.ts': 'export const loader = () => new Response("ok");\n',
      '/named.tsx': 'function Page() {\n  return null;\n}\nexport { Page as default };\n',
    });
    expect(
      flatRouteEntries(file('/_layout.tsx'), { path: '/', layout: true }).map((e) => e.name),
    ).toEqual(['loader /']);
    expect(
      flatRouteEntries(file('/health.ts'), { path: '/api/health', layout: false }).map(
        (e) => e.name,
      ),
    ).toEqual(['loader /api/health']);
    expect(
      flatRouteEntries(file('/named.tsx'), { path: '/x', layout: false }).map((e) => [
        e.name,
        e.handler !== undefined,
      ]),
    ).toEqual([['/x', true]]);
  });
});
