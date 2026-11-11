import { defineConfig, devices } from '@playwright/test';

// Visual tests run against two static builds, both made first by pnpm test:visual:
// - the catalogue (Storybook) for every component story
// - the web app's production build for the implemented screens, with a fake API
const storybookUrl = 'http://127.0.0.1:6008';
const appUrl = 'http://127.0.0.1:6009';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './visual',
  forbidOnly: isCi,
  // Screenshot baselines are only comparable on the same OS and browser build; {platform} keeps them apart.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-visual' }],
    ['json', { outputFile: 'reports-data/visual.json' }],
  ],
  // threshold 0: any colour change counts. Playwright's default (0.2) let a whole palette change pass unnoticed.
  // maxDiffPixels 4 (owner, 12 Nov 2026): under CPU load, Chromium draws 1-2 pixels of an icon's anti-aliased edge
  // 1-3 colour levels differently (2.5% of runs at heavy load, none at normal load; investigated in phase 4). Any
  // real change, such as a moved row, a colour or a missing icon, is hundreds of pixels.
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0,
      maxDiffPixels: 4,
      stylePath: './visual/screenshot.css',
    },
  },
  use: {
    // 2x for sharp screenshots; changing it invalidates every baseline.
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 2,
    // Grey text smoothing only: Chrome turns subpixel (LCD) smoothing on or off per compositor layer, which
    // made a few text pixels differ between runs (seen on the Popover story). Pixel-exact baselines need one mode.
    launchOptions: { args: ['--disable-lcd-text'] },
    viewport: { width: 800, height: 900 },
  },
  projects: [
    { name: 'catalogue', testMatch: 'catalogue.spec.ts', use: { baseURL: storybookUrl } },
    {
      name: 'screens',
      testMatch: 'screens.spec.ts',
      // 1x keeps the full-page baselines small; locale and time zone fixed so dates render the same everywhere.
      use: { baseURL: appUrl, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'UTC' },
    },
  ],
  // Vite's own binary, not pnpm: the tests run inside Playwright's Docker image, which has Node but no pnpm.
  webServer: [
    {
      command:
        'node node_modules/vite/bin/vite.js preview --outDir storybook-static --host 127.0.0.1 --port 6008 --strictPort',
      cwd: '../packages/ui',
      url: storybookUrl,
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      // The production headers (CSP) come with it: vite.config.ts serves public/_headers in preview.
      command:
        'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 6009 --strictPort',
      cwd: '../apps/web',
      url: appUrl,
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});
