import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, type SignedInEnv } from '../auth/guards.js';
import type { Database } from '../db/database.js';
import { ownsProject } from '../projects/projects.js';
import { importMasterKey } from './crypto.js';
import {
  checkSecretName,
  checkSecretValue,
  deleteSecret,
  listSecrets,
  putSecret,
  VALUE_MAX_BYTES,
} from './vault.js';

interface VaultDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly log: (message: string) => void;
}

type VaultContext = Context<SignedInEnv>;

const NOT_FOUND = { error: 'No such project.' } as const;

/**
 * /api/projects/:projectId/secrets, mounted inside the projects routes (so requireUser has already run).
 * Values go in and never come out: no route returns one, and no log line includes one.
 */
export function secretRoutes(deps: VaultDependencies) {
  const secrets = new Hono<SignedInEnv>();

  // Another person's project answers exactly like a missing one, so IDs can't be probed.
  async function ownProject(
    c: VaultContext,
  ): Promise<{ db: Database; projectId: string } | undefined> {
    const db = deps.database(c.env.DATABASE_URL ?? '');
    const projectId = c.req.param('projectId') ?? '';
    return (await ownsProject(db, projectId, c.get('user').id)) ? { db, projectId } : undefined;
  }

  function failed(c: VaultContext, action: string, error: unknown) {
    deps.log(`${action} failed: ${describeError(error)}`);
    return c.json({ error: `Could not ${action}. Try again in a moment.` }, 503);
  }

  secrets.get('/', async (c) => {
    try {
      const project = await ownProject(c);
      if (project === undefined) return c.json(NOT_FOUND, 404);
      return c.json({ secrets: await listSecrets(project.db, project.projectId) });
    } catch (error) {
      return failed(c, 'list the secrets', error);
    }
  });

  secrets.put(
    '/:name',
    requireSameOrigin,
    bodyLimit({
      // The value's 64 KiB, JSON-escaped, plus room for the field name.
      maxSize: VALUE_MAX_BYTES * 2 + 1024,
      onError: (c) => c.json({ error: 'Keep the value under 64 KB.', field: 'value' }, 413),
    }),
    async (c) => {
      const name = c.req.param('name');
      const nameProblem = checkSecretName(name);
      if (nameProblem !== undefined)
        return c.json({ error: nameProblem.message, field: 'name' }, 400);
      if (!c.req.header('content-type')?.startsWith('application/json')) {
        return c.json({ error: 'Send the secret as JSON.' }, 415);
      }
      let value: unknown;
      try {
        value = (await c.req.json<{ value?: unknown }>()).value;
      } catch {
        return c.json({ error: 'Send the secret as JSON.' }, 400);
      }
      const valueProblem = checkSecretValue(value);
      if (valueProblem !== undefined) {
        return c.json({ error: valueProblem.message, field: 'value' }, 400);
      }

      const vaultKey = c.env.VAULT_KEY;
      if (!vaultKey) {
        return c.json(
          { error: 'The secrets vault isn’t set up here (VAULT_KEY is missing).' },
          503,
        );
      }
      try {
        const project = await ownProject(c);
        if (project === undefined) return c.json(NOT_FOUND, 404);
        const result = await putSecret(project.db, await importMasterKey(vaultKey), {
          projectId: project.projectId,
          userId: c.get('user').id,
          name,
          value: value as string,
        });
        // Only the name and what happened: the value is never echoed.
        return c.json({ name, result }, result === 'created' ? 201 : 200);
      } catch (error) {
        return failed(c, 'save the secret', error);
      }
    },
  );

  secrets.delete('/:name', requireSameOrigin, async (c) => {
    try {
      const project = await ownProject(c);
      if (project === undefined) return c.json(NOT_FOUND, 404);
      const deleted = await deleteSecret(project.db, project.projectId, c.req.param('name'));
      return deleted ? c.body(null, 204) : c.json({ error: 'No secret with that name.' }, 404);
    } catch (error) {
      return failed(c, 'delete the secret', error);
    }
  });

  return secrets;
}
