import { test, expect } from './fixtures/base';

const INVALID_TOKEN = '00000000-0000-0000-0000-000000000000';
const NONSENSE_TOKEN = 'invalid-token-xyz';

test.describe('Guest link — invalid token', () => {
  test('blocked state for non-existent guest link UUID @smoke', async ({ page }) => {
    await page.goto(`/guest/${INVALID_TOKEN}`);
    await page.waitForTimeout(2000);

    const bodyText = (await page.locator('body').textContent()) ?? '';

    const showsModelData =
      bodyText.toLowerCase().includes('portfolio') && bodyText.toLowerCase().includes('cm');

    const showsBlockedState =
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.toLowerCase().includes('expired') ||
      bodyText.toLowerCase().includes('not found') ||
      bodyText.toLowerCase().includes('unavailable') ||
      bodyText.toLowerCase().includes('error') ||
      bodyText.toLowerCase().includes('access');

    expect(showsBlockedState || !showsModelData).toBe(true);
  });

  test('error state for nonsensical token string', async ({ page }) => {
    await page.goto(`/guest/${NONSENSE_TOKEN}`);
    await page.waitForTimeout(2000);

    const bodyText = (await page.locator('body').textContent()) ?? '';
    const showsPortfolioGrid =
      bodyText.toLowerCase().includes('cm') && bodyText.toLowerCase().includes('chest');
    expect(showsPortfolioGrid).toBe(false);
  });
});

test.describe('Guest link — HTTP responses', () => {
  test('guest link page responds (not a hard 500)', async ({ page }) => {
    const response = await page.goto(`/guest/${INVALID_TOKEN}`);
    expect(response?.status()).not.toBe(500);
  });

  test('random path under /guest/ does not expose model measurements grid', async ({ page }) => {
    await page.goto('/guest/random-garbage-path');
    await page.waitForTimeout(1500);
    const bodyText = (await page.locator('body').textContent()) ?? '';
    const lower = bodyText.toLowerCase();
    const showsSensitiveModelData =
      lower.includes('chest') && lower.includes('waist') && lower.includes('hips');
    expect(showsSensitiveModelData).toBe(false);
  });
});

test.describe('Guest link — scope isolation', () => {
  test('guest URL does not expose service_role or JWT in HTML source', async ({ page }) => {
    await page.goto(`/guest/${INVALID_TOKEN}`);

    const content = await page.content();

    expect(content).not.toMatch(/service_role/i);
    expect(content).not.toMatch(/supabase_access_token/i);
    expect(content).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}/);
  });
});
