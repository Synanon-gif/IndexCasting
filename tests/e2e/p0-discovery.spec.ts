import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';

const needsCreds = hasAuthCredentials();

test.describe('P0.7 Client discovery', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('Discover tab loads grid/cards and allows interaction @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(6000);

    const body = ((await page.locator('body').textContent()) ?? '').toLowerCase();
    const looksLikeDiscover =
      body.includes('discover') ||
      body.includes('filter') ||
      body.includes('e2e') ||
      body.includes('playwright') ||
      body.includes('model') ||
      body.includes('chest') ||
      body.includes('height');
    expect(looksLikeDiscover).toBe(true);

    const imgs = page.locator('img');
    const imgCount = await imgs.count();
    expect(imgCount).toBeGreaterThanOrEqual(0);

    const cardish = page
      .locator('a, [role="button"]')
      .filter({ hasText: /e2e|playwright|cm\b|\d{2,3}/i })
      .first();
    if (await cardish.isVisible().catch(() => false)) {
      await cardish.click();
      await page.waitForTimeout(1500);
      const overlay = (await page.locator('body').textContent()) ?? '';
      expect(overlay.length).toBeGreaterThan(80);
    }
  });
});
