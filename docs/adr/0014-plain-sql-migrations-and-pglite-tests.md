# 0014 — Plain SQL migrations, a small runner, and PGlite for tests

- Status: accepted
- Date: 30 Oct 2026
- Phase: 1c (step 2)

## Context

The control plane (ADR 0013) needs a Postgres schema on Neon (users, identities, sessions, projects, workspaces, encrypted secrets, usage) that changes safely over time. It must be applied identically to the local `dev` branch and to staging's `production` branch, and tested without a network.

## Options considered

1. **Plain SQL migration files with our own small runner (chosen).**
   - Exactly what the database receives is visible and reviewable.
   - Rules live as Postgres constraints.
   - Nothing is added to the Worker bundle.
   - About 80 lines of runner code to maintain.
2. **Drizzle ORM and drizzle-kit:** typed queries and generated migrations, but another abstraction to learn and trust, generated SQL to review anyway, and more in the Worker bundle.
3. **Kysely:** a typed query builder with migrations. Lighter than an ORM, but its migrations are TypeScript rather than SQL.

**For tests:** a real Postgres in Docker (slower, needs Docker for `pnpm test`), a Neon branch per test run (network, an API key, free-plan branch limits), or **PGlite**, real Postgres compiled to WebAssembly running inside the test process (chosen).

## Decision

- **Migrations:**
  - `services/control-plane/migrations/NNNN_name.sql`, applied in order, each in its own transaction, and recorded in `schema_migrations` with a SHA-256 of the file.
  - The runner (`src/db/migrations.ts`) refuses to continue when an applied file has changed, when the database has a migration the code doesn't know, or when files are badly named or share a number.
  - A failing migration rolls back completely.
- **Commands:**
  - `pnpm db:status`, `pnpm db:migrate`, `pnpm db:allow <email> [--admin]`.
  - They connect with the Neon driver's WebSocket `Client`, needed for multi-statement files and transactions, and read `DATABASE_URL` from `.dev.vars` unless it is exported.
  - They print the database host, never the password.
- **Queries from step 3 on:** the Neon driver's parameterised SQL with typed rows. Never string-built SQL.
- **Tests:** `@electric-sql/pglite` 0.5.10 (Apache-2.0, dev-only). It applies the real migrations to a fresh database per test and checks every constraint and cascade.
- **No personal data in migrations.** The repository is public, so the sign-in allowlist is filled with `pnpm db:allow`.

## Consequences

- **Migrations are SQL;** types for query results are written by hand next to the queries, kept honest by tests.
- **Postgres versions:** PGlite is Postgres 17, and Neon runs a recent Postgres. Features newer than PGlite supports would need a different test database.
- **Staging is migrated by hand** for now: `read -s -P 'Neon production URL: ' DATABASE_URL; DATABASE_URL=$DATABASE_URL pnpm db:migrate` in fish, so the URL never lands in shell history. Automatic migration on deploy waits for CI (upgrade-later 23).
- **One connection per command, so no advisory lock.** Two people migrating the same database at once could clash. Fine for now; revisit with CI (item 23).
