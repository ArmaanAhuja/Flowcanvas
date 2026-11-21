import { defineConfig } from '@playwright/test';

// The desktop app (build plan v2): Electron itself, launched by the test on a copy of a corpus fork. Run after
// `pnpm --filter @flowcanvas/desktop build` and `pnpm corpus:fetch`; on Linux CI under a virtual display (xvfb).
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './desktop',
  forbidOnly: isCi,
  timeout: 180_000,
  reporter: [
    isCi ? ['github'] : ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }],
    ['json', { outputFile: 'reports-data/desktop.json' }],
  ],
  use: { trace: 'on' },
});
