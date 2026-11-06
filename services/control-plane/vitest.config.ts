import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// Most tests here start their own in-process Postgres (PGlite). Vitest's default (a worker per core, 15 on the
// owner's laptop) took about 18 GiB at once and starved the laptop, enough for the resource guard to stop a
// workspace (phase 1d step 10). Measured on 16 cores: 6 workers finished fastest (68 s against 83 s by
// default) and left about 6 GiB more free. Never more than the cores minus one, though: 6 workers on CI's
// 4 cores made each Postgres start too slowly, and 21 setup hooks timed out (step 11).
export default defineConfig({
  test: {
    maxWorkers: Math.max(1, Math.min(6, availableParallelism() - 1)),
    // Closes each test's in-process databases when it ends (src/test/database.ts).
    setupFiles: ['./src/test/setup.ts'],
  },
});
