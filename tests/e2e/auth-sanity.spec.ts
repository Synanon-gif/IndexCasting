import { test, expect } from './fixtures/base';

/**
 * Lightweight auth shell checks (extend when CI has credentials).
 */

test.describe('Auth shell sanity', () => {
  test('document has a title after app load @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
});
