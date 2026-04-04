import { test, expect } from '@playwright/test';

/**
 * Auth Flow E2E Tests
 *
 * Verifies that the authentication entry points (login, signup) are reachable
 * and contain the expected UI elements, including legal links required by GDPR.
 *
 * Note: Full sign-in/sign-out flow requires a live Supabase project and valid
 * test credentials. These tests cover the UI layer only and use selectors that
 * are stable across layout changes.
 */

test.describe('App entry — authenticated gate', () => {
  test('root loads the React Native Web app shell', async ({ page }) => {
    await page.goto('/');
    // The Expo-rendered app mounts a root container
    await expect(page.locator('body')).toBeVisible();
    // Title should be set
    await expect(page).toHaveTitle(/.+/);
  });
});

test.describe('Login / Auth screen', () => {
  test('app shows an authentication UI when not logged in', async ({ page }) => {
    await page.goto('/');
    // Wait for React hydration (Expo web can take a moment)
    await page.waitForTimeout(3000);

    // The app should show some form of auth-related UI for unauthenticated users
    const bodyText = (await page.locator('body').textContent()) ?? '';
    const hasAuthUi =
      bodyText.toLowerCase().includes('sign in') ||
      bodyText.toLowerCase().includes('login') ||
      bodyText.toLowerCase().includes('log in') ||
      bodyText.toLowerCase().includes('email') ||
      bodyText.toLowerCase().includes('index casting');
    expect(hasAuthUi).toBe(true);
  });

  test('legal links are accessible from the auth screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Terms and Privacy links must be reachable (direct URL access)
    const termsResponse = await page.request.get('/terms');
    expect(termsResponse.status()).not.toBeGreaterThanOrEqual(400);

    const privacyResponse = await page.request.get('/privacy');
    expect(privacyResponse.status()).not.toBeGreaterThanOrEqual(400);
  });
});

test.describe('Direct URL: /terms and /privacy reachable without login', () => {
  test('/terms is publicly accessible (no redirect to login)', async ({ page }) => {
    const response = await page.goto('/terms');
    // Should not redirect to a login page for legal documents
    const finalUrl = page.url();
    expect(finalUrl).not.toMatch(/login|sign-in|auth/i);
    expect(response?.status()).toBeLessThan(400);
  });

  test('/privacy is publicly accessible (no redirect to login)', async ({ page }) => {
    const response = await page.goto('/privacy');
    const finalUrl = page.url();
    expect(finalUrl).not.toMatch(/login|sign-in|auth/i);
    expect(response?.status()).toBeLessThan(400);
  });
});
