import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level release gate (#216): a deliberately small suite covering the
 * critical designer flows plus a handful of visual-regression baselines —
 * not an exhaustive e2e matrix. Runs against the Vite dev server (no worker
 * APIs; network-backed flows are mocked per-test with page.route).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxed dev environments can point at a pre-provisioned Chromium
    // instead of downloading one (`npx playwright install` stays the default).
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          },
        }
      : {}),
  },
  expect: {
    toHaveScreenshot: {
      // Absorb minor antialiasing drift across chromium builds; real layout
      // or styling regressions move far more pixels than this.
      maxDiffPixelRatio: 0.02,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
