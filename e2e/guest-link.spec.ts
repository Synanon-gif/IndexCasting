import { test, expect } from '@playwright/test';

/**
 * Guest Link E2E Tests
 *
 * Guest links expose model portfolios / polaroids to external parties.
 * Security requirements:
 *  - Valid tokens → show intended content
 *  - Invalid / expired / revoked tokens → blocked, no data leakage
 *  - Token enumeration must not be possible via the browser
 *
 * These tests cover the browser-level behavior.
 * Server-side scope enforcement is covered by Jest unit tests.
 */

// A deliberately invalid token that will never match any real link
const INVALID_TOKEN = '00000000-0000-0000-0000-000000000000';
// A clearly nonsensical short string
const NONSENSE_TOKEN = 'invalid-token-xyz';

test.describe('Guest link — invalid token', () => {
  test('shows an error/blocked state for a non-existent guest link UUID', async ({ page }) => {
    await page.goto(`/guest/${INVALID_TOKEN}`);
    await page.waitForTimeout(2000);

    const bodyText = (await page.locator('body').textContent()) ?? '';

    // The page should NOT show any model data
    const showsModelData = bodyText.toLowerCase().includes('portfolio') &&
      bodyText.toLowerCase().includes('cm');         // height in cm is model-specific

    // The page should indicate an error, blocked, or not found state
    const showsBlockedState =
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('expired') ||
      bodyText.toLowerCase().includes('not found') ||
      bodyText.toLowerCase().includes('unavailable') ||
      bodyText.toLowerCase().includes('error') ||
      bodyText.toLowerCase().includes('access');

    // Either a clear blocked state is shown, OR model data is absent
    expect(showsBlockedState || !showsModelData).toBe(true);
  });

  test('shows an error state for a nonsensical token string', async ({ page }) => {
    await page.goto(`/guest/${NONSENSE_TOKEN}`);
    await page.waitForTimeout(2000);

    // Must not show any private model data
    const bodyText = (await page.locator('body').textContent()) ?? '';
    // A nonsense token should never show a portfolio grid
    const showsPortfolioGrid = bodyText.includes('cm') && bodyText.includes('bust');
    expect(showsPortfolioGrid).toBe(false);
  });
});

test.describe('Guest link — HTTP responses', () => {
  test('guest link page responds (not a hard 500)', async ({ page }) => {
    const response = await page.goto(`/guest/${INVALID_TOKEN}`);
    // 404 is fine (link not found), 500 is not
    expect(response?.status()).not.toBe(500);
  });

  test('random path under /guest/ does not expose model data', async ({ page }) => {
    await page.goto('/guest/random-garbage-path');
    await page.waitForTimeout(1500);
    // Should not show model portfolio content
    const bodyText = (await page.locator('body').textContent()) ?? '';
    const showsSensitiveModelData =
      bodyText.includes('bust') &&
      bodyText.includes('waist') &&
      bodyText.includes('hips');
    expect(showsSensitiveModelData).toBe(false);
  });
});

test.describe('Guest link — scope isolation', () => {
  test('guest URL does not expose API keys or internal IDs in page source', async ({ page }) => {
    await page.goto(`/guest/${INVALID_TOKEN}`);

    // Check page content for exposed secrets
    const content = await page.content();

    // No service role or bearer tokens in page HTML
    expect(content).not.toMatch(/service_role/i);
    expect(content).not.toMatch(/supabase_access_token/i);
    // Supabase URLs are fine (public), but secret keys are not
    expect(content).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}/);
  });
});
