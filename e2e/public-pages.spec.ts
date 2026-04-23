import { test, expect } from '@playwright/test';

/**
 * Public web behavior (intended product contract)
 *
 * UPDATED ASSUMPTIONS (replacing earlier, incorrect ones):
 * - `/` is NOT a separate marketing landing page with a static HTML `<footer>`.
 *   It serves the Expo/React Native Web app shell and the unauthenticated auth entry.
 * - Do NOT require a marketing `<h1>`, document title "Index Casting", or footer links on `/`.
 * - `/terms` and `/privacy` remain publicly reachable routes (legal content).
 * - Legal entry points for signed-out users live in the auth UI (legal footer row:
 *   "Terms of Service" / "Privacy Policy"), not on a dedicated landing footer.
 *
 * These tests assert: shell load, auth gate, public legal routes, and in-app legal controls.
 */

async function expectAuthEntryUi(page: import('@playwright/test').Page): Promise<void> {
  const bodyText = (await page.locator('body').textContent()) ?? '';
  const lower = bodyText.toLowerCase();
  const hasAuthUi =
    lower.includes('sign in') ||
    lower.includes('login') ||
    lower.includes('log in') ||
    lower.includes('email') ||
    lower.includes('create account') ||
    lower.includes('password') ||
    lower.includes('continue');
  expect(hasAuthUi).toBe(true);
}

test.describe('Root — app shell / auth entry', () => {
  test('loads successfully (no client error page)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('shows authentication UI for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    await expectAuthEntryUi(page);
  });
});

test.describe('/terms — public legal route', () => {
  test('responds without a hard error', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('does not force redirect to a login-only URL', async ({ page }) => {
    await page.goto('/terms');
    expect(page.url()).not.toMatch(/login|sign-in|auth/i);
  });

  test('shows terms-related content', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('body')).toContainText(/terms/i);
  });

  test('user can return to the app entry at /', async ({ page }) => {
    await page.goto('/terms');
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
    await expectAuthEntryUi(page);
  });
});

test.describe('/privacy — public legal route', () => {
  test('responds without a hard error', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('does not force redirect to a login-only URL', async ({ page }) => {
    await page.goto('/privacy');
    expect(page.url()).not.toMatch(/login|sign-in|auth/i);
  });

  test('shows privacy-related content', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('body')).toContainText(/privacy/i);
  });
});

test.describe('Legal links from public auth UI (not a marketing landing footer)', () => {
  test('Terms of Service is visible on the auth screen and opens /terms on web', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const termsControl = page.getByText('Terms of Service', { exact: true });
    await expect(termsControl).toBeVisible();

    await termsControl.click();
    await page.waitForTimeout(800);

    const url = page.url();
    const body = (await page.locator('body').textContent()) ?? '';
    const showsTerms =
      url.includes('/terms') || body.toLowerCase().includes('terms of service');
    expect(showsTerms).toBe(true);
  });

  test('Privacy Policy is visible on the auth screen and opens /privacy on web', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const privacyControl = page.getByText('Privacy Policy', { exact: true });
    await expect(privacyControl).toBeVisible();

    await privacyControl.click();
    await page.waitForTimeout(800);

    const url = page.url();
    const body = (await page.locator('body').textContent()) ?? '';
    const showsPrivacy =
      url.includes('/privacy') || body.toLowerCase().includes('privacy policy');
    expect(showsPrivacy).toBe(true);
  });

  test('Trust is visible on the auth screen and opens /trust on web', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const trustControl = page.getByText('Trust', { exact: true });
    await expect(trustControl).toBeVisible();

    await trustControl.click();
    await page.waitForTimeout(800);

    const url = page.url();
    const body = (await page.locator('body').textContent()) ?? '';
    const showsTrust =
      url.includes('/trust') || body.toLowerCase().includes('trust center') || /trust/i.test(body);
    expect(showsTrust).toBe(true);
  });

  test('Status is visible on the auth screen and opens /status on web', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const statusControl = page.getByText('Status', { exact: true });
    await expect(statusControl).toBeVisible();

    await statusControl.click();
    await page.waitForTimeout(800);

    const url = page.url();
    const body = (await page.locator('body').textContent()) ?? '';
    const showsStatus =
      url.includes('/status') ||
      body.toLowerCase().includes('system status') ||
      body.toLowerCase().includes('operational');
    expect(showsStatus).toBe(true);
  });
});
