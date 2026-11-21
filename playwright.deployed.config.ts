import { defineConfig } from '@playwright/test';
import localConfig from './playwright.config.js';

const baseURL = process.env.E2E_DEPLOYED_URL;
if (
  !baseURL ||
  !baseURL.startsWith('https://') ||
  !URL.canParse(baseURL) ||
  new URL(baseURL).origin !== baseURL
) {
  throw new Error(
    'Set E2E_DEPLOYED_URL to the HTTPS origin, without a trailing slash.',
  );
}
if (!/^[a-f0-9]{40}$/.test(process.env.E2E_DEPLOYED_SHA ?? '')) {
  throw new Error(
    'Set E2E_DEPLOYED_SHA to the full commit SHA of the release candidate.',
  );
}

export default defineConfig({
  ...localConfig,
  testDir: './e2e/deployed',
  testIgnore: [],
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-deployed/report' }],
  ],
  outputDir: 'playwright-deployed/results',
  webServer: undefined,
  use: { ...localConfig.use, baseURL, trace: 'retain-on-failure' },
});
