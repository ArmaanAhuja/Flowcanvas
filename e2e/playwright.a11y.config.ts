import { defineConfig, devices } from '@playwright/test';

// The catalogue's accessibility check (axe, WCAG 2.2 AA): every component story in both themes, against the built
// Storybook (made first by `pnpm test:a11y`). No screenshots since 21 Nov 2026 (owner): nothing is compared pixel
// for pixel, so it runs on any machine without Playwright's Docker image.
const storybookUrl = 'http://127.0.0.1:6008';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './visual',
  forbidOnly: isCi,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-a11y' }],
    ['json', { outputFile: 'reports-data/a11y.json' }],
  ],
  // Each story is read settled: openStory waits for its fetches, fonts and two drawn frames (without the screenshots'
  // own wait, axe caught text mid-layout and failed at random).
  use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 900 } },
  projects: [{ name: 'catalogue', testMatch: 'catalogue.spec.ts', use: { baseURL: storybookUrl } }],
  webServer: [
    {
      command:
        'node node_modules/vite/bin/vite.js preview --outDir storybook-static --host 127.0.0.1 --port 6008 --strictPort',
      cwd: '../packages/ui',
      url: storybookUrl,
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});
