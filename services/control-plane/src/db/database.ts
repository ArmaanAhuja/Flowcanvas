import { neon } from '@neondatabase/serverless';

/** What request handlers need from Postgres: one parameterised statement at a time. */
export interface Database {
  readonly query: <Row>(sql: string, params?: readonly unknown[]) => Promise<Row[]>;
}

/**
 * Neon's serverless driver sends each statement over HTTPS, which suits Workers (no long-lived sockets).
 * There are no interactive transactions over HTTP, so writes that belong together are one statement.
 */
export function neonDatabase(databaseUrl: string): Database {
  const sql = neon(databaseUrl);
  return {
    query: async <Row>(text: string, params: readonly unknown[] = []) =>
      (await sql.query(text, [...params])) as Row[],
  };
}
