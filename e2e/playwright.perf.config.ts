import { defineConfig, devices } from '@playwright/test';

// The canvas performance test (phase 2 step 7): no slow motion and no recording, since both distort timing.
// `PERF_REAL=1` runs it in a real window with the machine's GPU (the laptop); otherwise headless, as on CI,
// where it only catches large regressions.
const real = process.env.PERF_REAL === '1';
const localPreviewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './perf',
  reporter: [['list'], ['json', { outputFile: 'reports-data/perf.json' }]],
  use: { baseURL: localPreviewUrl },
  projects: [
    {
      name: real ? 'perf-real' : 'perf-headless',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: !real,
        video: 'off',
        trace: 'off',
        launchOptions: { slowMo: 0 },
      },
    },
  ],
  webServer: {
    command:
      'pnpm --filter @flowcanvas/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: localPreviewUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
