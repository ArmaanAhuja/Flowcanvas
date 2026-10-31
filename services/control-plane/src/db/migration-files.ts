import { readdirSync, readFileSync } from 'node:fs';
import { orderMigrations, type Migration } from './migrations.js';

/** The migration files in services/control-plane/migrations, in order. */
export function loadMigrations(
  folder = new URL('../../migrations/', import.meta.url),
): Migration[] {
  return orderMigrations(
    readdirSync(folder)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(new URL(name, folder), 'utf8') })),
  );
}
