import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, requireUser, type SignedInEnv } from '../auth/guards.js';
import type { Database } from '../db/database.js';
import { secretRoutes } from '../vault/routes.js';
import { createProject, listProjects, parseNewProject } from './projects.js';

interface ProjectDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly log: (message: string) => void;
}

/** /api/projects: the signed-in person's projects. */
export function projectRoutes(deps: ProjectDependencies) {
  const projects = new Hono<SignedInEnv>();
  projects.use(requireUser(deps));

  projects.get('/', async (c) => {
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      return c.json({ projects: await listProjects(db, c.get('user').id) });
    } catch (error) {
      deps.log(`listing projects failed: ${describeError(error)}`);
      return c.json({ error: 'Could not load your projects. Try again in a moment.' }, 503);
    }
  });

  projects.post(
    '/',
    requireSameOrigin,
    // A project is a name and an address; anything bigger isn't a real request.
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (c) => c.json({ error: 'That request is too large.' }, 413),
    }),
    async (c) => {
      if (!c.req.header('content-type')?.startsWith('application/json')) {
        return c.json({ error: 'Send the project as JSON.' }, 415);
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Send the project as JSON.' }, 400);
      }
      const parsed = parseNewProject(body);
      if ('field' in parsed) return c.json({ error: parsed.message, field: parsed.field }, 400);

      try {
        const db = deps.database(c.env.DATABASE_URL ?? '');
        const created = await createProject(db, c.get('user').id, parsed);
        if (created === 'duplicate-name') {
          return c.json(
            { error: 'You already have a project with that name.', field: 'name' },
            409,
          );
        }
        return c.json({ project: created }, 201);
      } catch (error) {
        deps.log(`creating a project failed: ${describeError(error)}`);
        return c.json({ error: 'Could not create the project. Try again in a moment.' }, 503);
      }
    },
  );

  projects.route('/:projectId/secrets', secretRoutes(deps));

  return projects;
}
