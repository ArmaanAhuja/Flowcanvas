import { defineConfig } from 'vitest/config';

// Most tests here start their own in-process Postgres (PGlite). Vitest's default (a worker per core, 15 on the
// owner's laptop) took about 18 GiB at once and starved the laptop, enough for the resource guard to stop a
// workspace (phase 1d step 10). Measured on 16 cores: 6 workers finished fastest (68 s against 83 s by
// default) and left about 6 GiB more free.
export default defineConfig({
  test: {
    maxWorkers: 6,
  },
});
