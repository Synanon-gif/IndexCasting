import { test, expect } from '@playwright/test';

/**
 * Auth-focused E2E (sessions, sign-in, logout) — extend here when CI has test credentials.
 *
 * UPDATED: Unauthenticated public entry, `/terms`, `/privacy`, and legal links from the
 * auth UI are covered in `e2e/public-pages.spec.ts` (no duplicate root / marketing assumptions).
 */

test.describe('Auth shell sanity (non-marketing)', () => {
  test('document has a title after app load', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
});
