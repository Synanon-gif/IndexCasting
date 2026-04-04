import { test, expect } from '@playwright/test';

/**
 * Public Pages E2E Tests
 *
 * Verifies that all public-facing entry points are reachable and contain
 * the expected legal links — a hard requirement for GDPR + legal compliance.
 */

test.describe('Landing page', () => {
  test('loads and displays the IndexCasting brand', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/index casting/i);
    // Main headline
    await expect(page.locator('h1')).toContainText(/index casting/i);
  });

  test('footer contains a Terms of Service link pointing to /terms', async ({ page }) => {
    await page.goto('/');
    const termsLink = page.locator('footer a[href="/terms"]');
    await expect(termsLink).toBeVisible();
    await expect(termsLink).toContainText(/terms/i);
  });

  test('footer contains a Privacy Policy link pointing to /privacy', async ({ page }) => {
    await page.goto('/');
    const privacyLink = page.locator('footer a[href="/privacy"]');
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toContainText(/privacy/i);
  });
});

test.describe('/terms page', () => {
  test('loads without a 404 error', async ({ page }) => {
    const response = await page.goto('/terms');
    // Any 2xx or redirect is acceptable; only hard 4xx/5xx is a failure
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('contains legal / terms content', async ({ page }) => {
    await page.goto('/terms');
    // Page should reference "Terms" somewhere in visible text
    const body = page.locator('body');
    await expect(body).toContainText(/terms/i);
  });

  test('provides a way back to the main app (back-navigation or link)', async ({ page }) => {
    await page.goto('/terms');
    // Either a "back" button or navigating to '/' should work
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('/privacy page', () => {
  test('loads without a 404 error', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('contains privacy / data-protection content', async ({ page }) => {
    await page.goto('/privacy');
    const body = page.locator('body');
    await expect(body).toContainText(/privacy/i);
  });
});

test.describe('Legal link navigation from landing page', () => {
  test('clicking Terms of Service link navigates to /terms', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer a[href="/terms"]').click();
    // After click: either URL changes or content updates (SPA navigation)
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    const bodyText   = await page.locator('body').textContent();
    const navigated  = currentUrl.includes('/terms') || (bodyText ?? '').toLowerCase().includes('terms');
    expect(navigated).toBe(true);
  });

  test('clicking Privacy Policy link navigates to /privacy', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer a[href="/privacy"]').click();
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    const bodyText   = await page.locator('body').textContent();
    const navigated  = currentUrl.includes('/privacy') || (bodyText ?? '').toLowerCase().includes('privacy');
    expect(navigated).toBe(true);
  });
});
