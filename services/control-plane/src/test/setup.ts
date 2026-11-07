// Runs in every control-plane test file (vitest.config.ts): the migrated template is prepared before the
// tests, and each test's databases are closed when it ends, so their memory is freed at once instead of
// piling up (phase 1d step 11).
import { afterEach, beforeAll } from 'vitest';
import { closeOpenDatabases, prepareDatabaseTemplate } from './database.js';

// The one slow part, once per test file and with time for a cold start; each test then clones it in 0.2 s,
// under the usual 10 s hook limit.
beforeAll(async () => {
  await prepareDatabaseTemplate();
}, 60_000);

afterEach(async () => {
  await closeOpenDatabases();
});
