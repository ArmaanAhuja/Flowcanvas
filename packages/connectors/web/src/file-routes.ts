// Routes named by their files (ADR 0030): Next.js's app router and `remix-flat-routes` (Documenso's React Router).
// Pure: a file's path in, its route out, or null when the file isn't a route. Paths use `:name` for a parameter and
// `*` for the rest of the path, whatever the framework writes.

const SCRIPT = /\.(tsx|ts|jsx|js|mdx)$/;

/** What a file in a Next.js `app/` folder is: a page, a route handler, or neither. */
export interface NextRoute {
  readonly kind: 'page' | 'route';
  readonly path: string;
}

/**
 * A file under a Next.js app router's `app/` folder, by its path inside it (`polls/[urlId]/page.tsx`). Route groups
 * (`(admin)`) and parallel slots (`@modal`) add nothing to the path; private folders (`_components`) and intercepting
 * routes (`(.)photo`, which show another route's URL) aren't routes. https://nextjs.org/docs/app/getting-started/project-structure
 */
export function nextAppRoute(inApp: string): NextRoute | null {
  const parts = inApp.split('/');
  const file = parts.pop() ?? '';
  const kind = /^page\.(tsx|ts|jsx|js|mdx)$/.test(file)
    ? 'page'
    : /^route\.(ts|js)$/.test(file)
      ? 'route'
      : null;
  if (kind === null) return null;
  const segments: string[] = [];
  for (const part of parts) {
    if (part.startsWith('_')) return null;
    if (/^\(\.{1,3}\)|^\(\.\.\)/.test(part)) return null;
    if (/^\(.*\)$/.test(part) || part.startsWith('@')) continue;
    const optionalRest = /^\[\[\.\.\.(.+)\]\]$/.exec(part);
    const rest = /^\[\.\.\.(.+)\]$/.exec(part);
    const param = /^\[(.+)\]$/.exec(part);
    if (optionalRest !== null || rest !== null) segments.push('*');
    else if (param !== null) segments.push(`:${param[1] ?? ''}`);
    else segments.push(part);
  }
  return { kind, path: `/${segments.join('/')}` };
}

/** What a file under `app/routes` is with `remix-flat-routes`. */
export interface FlatRoute {
  readonly path: string;
  /** A `_layout` (or a pathless `_name` route's own file): it wraps routes, it isn't a page of its own. */
  readonly layout: boolean;
}

/**
 * A file under `remix-flat-routes`' routes folder, by its path inside it (`_authenticated+/settings+/profile.tsx`).
 * Folders ending in `+` flatten into the name; segments are split on `.`; `_index` is the index; `_layout` and
 * `_name` add no URL segment; `$id` is a parameter, `$` the rest of the path; `($lang)` is optional; a trailing `_`
 * leaves its parent's layout; `[...]` escapes. A folder without `+` is a route whose own file is `route`, `index`,
 * `_index`, `_layout` or `page` inside it. https://github.com/kiliman/remix-flat-routes
 */
export function flatRoute(inRoutes: string): FlatRoute | null {
  if (!SCRIPT.test(inRoutes)) return null;
  const parts = inRoutes.split('/');
  if (parts.some((part) => part.startsWith('.'))) return null;
  const file = (parts.pop() ?? '').replace(SCRIPT, '');
  const names: string[] = [];
  for (const folder of parts) {
    if (folder.endsWith('+')) names.push(folder.slice(0, -1));
    else names.push(folder);
  }
  // In a folder without `+`, the file names the folder's route only if it's one of the route file names.
  const plainFolder = parts.length > 0 && !(parts.at(-1) ?? '').endsWith('+');
  if (plainFolder) {
    if (!['route', 'index', '_index', '_layout', 'page', '_route'].includes(file)) return null;
    if (file === '_index' || file === 'index') names.push('_index');
    else if (file === '_layout') names.push('_layout');
  } else {
    names.push(file);
  }
  const segments = names.flatMap((name) => splitDots(name));
  const last = segments.at(-1) ?? '';
  const layout = last === '_layout' || (last.startsWith('_') && last !== '_index');
  const path = segments
    .filter((segment) => segment !== '_index' && segment !== '_layout' && !isPathless(segment))
    .map((segment) => urlSegment(segment));
  return { path: `/${path.join('/')}`, layout };
}

/** `a.b` into its segments, not splitting inside `[...]`. */
function splitDots(name: string): string[] {
  const segments: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of name) {
    if (char === '[') escaped = true;
    if (char === ']') escaped = false;
    if (char === '.' && !escaped) {
      segments.push(current);
      current = '';
    } else current += char;
  }
  segments.push(current);
  return segments.filter((segment) => segment !== '');
}

const isPathless = (segment: string) => segment.startsWith('_') && !segment.startsWith('_[');

function urlSegment(raw: string): string {
  const segment = raw.endsWith('_') && !raw.endsWith('\\_') ? raw.slice(0, -1) : raw;
  const optional = /^\((.+)\)$/.exec(segment);
  const inner = optional?.[1] ?? segment;
  const piece =
    inner === '$'
      ? '*'
      : inner.startsWith('$')
        ? `:${inner.slice(1)}`
        : inner.replace(/\[([^\]]*)\]/g, '$1');
  return optional === null ? piece : `${piece}?`;
}
