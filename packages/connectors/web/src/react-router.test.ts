import { describe, expect, it } from 'vitest';
import {
  joinReactRouter,
  reactRouterOf,
  type JoinableRoute,
  type JoinableTree,
} from './react-router.js';
import { programOf } from './test-program.js';

describe('reactRouterOf', () => {
  it('reads route objects: paths, children, redirects, lazy pages and the component each renders', () => {
    const file = programOf({
      '/routes.tsx': [
        "import { createBrowserRouter, Navigate } from 'react-router-dom';",
        'export const router = createBrowserRouter([',
        "  { path: 'share/:shareId', element: <ShareRoute /> },",
        "  { path: '/', element: <Root />, children: [",
        "    { index: true, element: <Navigate to='/c/new' /> },",
        "    { path: 'c/:conversationId?', element: <ChatRoute /> },",
        "    { path: 'skills', lazy: loadSkills },",
        '  ] },',
        ']);',
      ].join('\n'),
    });
    const [tree] = reactRouterOf(file('/routes.tsx'));
    expect(tree?.root).toBe(true);
    const [share, root] = tree?.routes ?? [];
    expect([share?.path, share?.element !== undefined, share?.at.line]).toEqual([
      'share/:shareId',
      true,
      3,
    ]);
    expect(root?.children.map((r) => [r.path, r.index, r.redirect, r.lazy])).toEqual([
      [undefined, true, true, false],
      ['c/:conversationId?', false, false, false],
      ['skills', false, false, true],
    ]);
  });

  it('reads <Route> elements with paths from an enum, and a <Routes> block inside a component', () => {
    const file = programOf({
      '/paths.ts': "export enum SettingsPath { Profile = 'profile', Experience = 'experience' }",
      '/settings.tsx': [
        "import { Route, Routes } from 'react-router-dom';",
        "import { SettingsPath } from './paths';",
        'export const SettingsRoutes = () => (',
        '  <Routes>',
        '    <Route path={SettingsPath.Profile} element={<SettingsProfile />} />',
        '    <Route element={<Guard />}>',
        '      <Route path={SettingsPath.Experience} element={<SettingsExperience />} />',
        '    </Route>',
        '  </Routes>',
        ');',
      ].join('\n'),
    });
    const [tree] = reactRouterOf(file('/settings.tsx'));
    expect(tree?.root).toBe(false);
    expect(tree?.within).toBeDefined();
    expect(tree?.routes.map((r) => [r.path, r.children.map((c) => c.path)])).toEqual([
      ['profile', []],
      [undefined, ['experience']],
    ]);
  });

  it('follows routes built by functions in other files, through createRoutesFromElements and a pass-through', () => {
    const file = programOf({
      '/settings.tsx': [
        "import { createRoutesFromElements, Route } from 'react-router-dom';",
        'type R = { path?: string }[];',
        'const elements = () => (',
        '  <>',
        "    <Route path='profile' element={<Profile />} />",
        "    <Route path='billing' element={<Billing />} />",
        '  </>',
        ');',
        'const stripIds = (routes: R): R => routes.map((r) => r);',
        'export const settingsRoutes = (): R => stripIds(createRoutesFromElements(elements()) as R);',
      ].join('\n'),
      '/app.tsx': [
        "import { createBrowserRouter } from 'react-router-dom';",
        "import { settingsRoutes } from './settings';",
        'const children = settingsRoutes();',
        "export const router = createBrowserRouter([{ path: 'settings', element: <Outlet />, children }, { path: 'x', children: load() }]);",
      ].join('\n'),
    });
    const [tree] = reactRouterOf(file('/app.tsx'));
    const settings = tree?.routes[0];
    expect(settings?.children.map((r) => [r.path, r.file])).toEqual([
      ['profile', '/settings.tsx'],
      ['billing', '/settings.tsx'],
    ]);
    // A function the code doesn't declare: its routes are marked, not guessed.
    expect(tree?.routes[1]?.unfollowed).toBe(
      'Its routes come from a function whose code isn’t followed.',
    );
  });

  it('follows a parameter to its caller’s argument, a route object by name, and a route behind a flag', () => {
    const file = programOf({
      '/dashboard.tsx': "export default { path: 'd/*', element: <Dashboard /> };",
      '/app.tsx': [
        "import { createBrowserRouter, Route, createRoutesFromElements } from 'react-router-dom';",
        "import dashboard from './dashboard';",
        'declare const admin: boolean;',
        'const forSurface = (routes: unknown, surface: string) => pick(routes, surface);',
        'const pick = (routes: any, _s: string) => routes.flatMap((r: any) => [r]);',
        "const all = [{ path: 'home', element: <Home /> }, dashboard];",
        'export const router = createBrowserRouter([',
        "  { path: '/', element: <Layout />, children: forSurface(all, 'main') },",
        "  { path: 'admin', element: <Outlet />, children: createRoutesFromElements(<>{admin && <Route path='panel' element={<Panel />} />}</>) },",
        ']);',
      ].join('\n'),
    });
    const [tree] = reactRouterOf(file('/app.tsx'));
    expect(tree?.routes[0]?.children.map((r) => [r.path, r.file])).toEqual([
      ['home', '/app.tsx'],
      ['d/*', '/dashboard.tsx'],
    ]);
    expect(tree?.routes[0]?.unfollowed).toBeUndefined();
    expect(tree?.routes[1]?.children.map((r) => r.path)).toEqual(['panel']);
  });

  it('reads nothing in a file that doesn’t use React Router', () => {
    const file = programOf({
      '/x.tsx': 'export const Route = () => null;\nconst a = <Route path="/x" />;\n',
    });
    expect(reactRouterOf(file('/x.tsx'))).toEqual([]);
  });
});

describe('joinReactRouter', () => {
  const route = (over: Partial<JoinableRoute> & { readonly line: number }): JoinableRoute => ({
    path: undefined,
    index: false,
    at: { line: over.line, column: 1 },
    redirect: false,
    lazy: false,
    children: [],
    ...over,
  });

  it('lists leaf pages with full paths, into trees a route’s component holds, and not layouts or redirects', () => {
    const trees: JoinableTree[] = [
      {
        file: 'app.tsx',
        root: true,
        routes: [
          route({ line: 1, path: 'share/:shareId', component: 'ShareRoute' }),
          route({
            line: 2,
            path: '/',
            component: 'Root',
            children: [
              route({ line: 3, index: true, redirect: true }),
              route({ line: 4, path: 'c/:id?', component: 'Chat' }),
              route({ line: 5, path: 'settings/*', component: 'SettingsRoutes' }),
              route({ line: 6, path: 'skills', lazy: true }),
            ],
          }),
        ],
      },
      {
        file: 'settings.tsx',
        root: false,
        within: 'SettingsRoutes',
        routes: [route({ line: 9, path: 'profile', component: 'Profile' })],
      },
    ];
    expect(joinReactRouter(trees).map((e) => [e.name, e.complete, e.file])).toEqual([
      ['/share/:shareId', true, 'app.tsx'],
      ['/c/:id?', true, 'app.tsx'],
      ['/settings/profile', true, 'settings.tsx'],
      ['/skills', true, 'app.tsx'],
    ]);
  });

  it('marks a path the code doesn’t fix', () => {
    const trees: JoinableTree[] = [
      { file: 'a.tsx', root: true, routes: [route({ line: 1, path: null, component: 'X' })] },
    ];
    expect(joinReactRouter(trees).map((e) => [e.name, e.complete])).toEqual([['/:unknown', false]]);
  });
});
