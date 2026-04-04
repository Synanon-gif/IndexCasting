import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Config — IndexCasting Web
 *
 * Runs against the Expo web dev server on localhost:8081.
 * Set PLAYWRIGHT_BASE_URL env var to override (e.g. Vercel preview URL).
 *
 * To run against a pre-running server (skip auto-start):
 *   PLAYWRIGHT_SKIP_WEB_SERVER=1 npx playwright test
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8081';
const SKIP_WEB_SERVER = !!process.env.PLAYWRIGHT_SKIP_WEB_SERVER;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Expo dev server is shared; avoid concurrent page restarts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace:   'on-first-retry',
    // Expo web bundles can be slow; generous timeout
    actionTimeout:     15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name:  'chromium',
      use:   { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test mobile viewports
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],

  // Auto-start the Expo web server when running E2E locally
  webServer: SKIP_WEB_SERVER
    ? undefined
    : {
        command:          'npx expo start --web --port 8081 --no-dev',
        url:              BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout:          120_000,
        stdout:           'pipe',
        stderr:           'pipe',
      },
});
