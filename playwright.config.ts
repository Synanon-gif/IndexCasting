import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

import { pathToE2eEnvFile } from './tests/e2e/helpers/env';

// Local secrets + base URL (never committed). Override file with E2E_ENV_FILE=.env.e2e.staging (shell/npm only).
loadEnv({ path: pathToE2eEnvFile() });

const BASE_URL =
  process.env.E2E_BASE_URL?.trim() ||
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  'http://localhost:8081';

function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

const shouldStartExpoWeb =
  isLocalBaseUrl(BASE_URL) &&
  process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== '1' &&
  process.env.E2E_SKIP_WEB_SERVER !== '1';

/**
 * Playwright E2E — IndexCasting Web
 *
 * - `E2E_BASE_URL` (preferred) or `PLAYWRIGHT_BASE_URL` — e.g. https://www.index-casting.com
 * - `E2E_ENV_FILE` — optional; defaults to `.env.e2e`. Use named profiles (see `.env.e2e.*.example`).
 * - Local default `http://localhost:8081` starts Expo web unless `PLAYWRIGHT_SKIP_WEB_SERVER=1`
 *
 * See `docs/e2e-testing-setup.md` and `docs/e2e-test-matrix.md`.
 */
export default defineConfig({
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results',

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'e2e-artifacts/results.json' }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-iphone-se',
      use: { ...devices['iPhone SE'] },
    },
    {
      name: 'mobile-iphone-14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'tablet-ipad',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],

  webServer: shouldStartExpoWeb
    ? {
        command: 'npx expo start --web --port 8081 --no-dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
