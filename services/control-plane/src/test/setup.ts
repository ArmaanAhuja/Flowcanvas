// Runs in every control-plane test file (vitest.config.ts): each test's databases are closed when it ends,
// so their memory is freed at once instead of piling up (phase 1d step 11).
import { afterEach } from 'vitest';
import { closeOpenDatabases } from './database.js';

afterEach(async () => {
  await closeOpenDatabases();
});
