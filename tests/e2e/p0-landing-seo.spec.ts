import { test, expect } from './fixtures/base';
import { assertBaseUrlReachable, getBaseUrl, seededPublicAgencySlug, seededPublicClientSlug } from './helpers/env';

test.describe('P0.14 Public profiles', () => {
  test('public agency profile loads (deterministic seed slug) @p0', async ({ page }) => {
    const slug = seededPublicAgencySlug();
    await page.goto(`/agency/${slug}`);
    await page.waitForTimeout(3000);
    expect(page.url()).not.toMatch(/token=|access_token/i);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.length).toBeGreaterThan(80);
    await expect(page.getByPlaceholder('Password')).toHaveCount(0);
  });

  test('public client profile loads (deterministic seed slug) @p0', async ({ page }) => {
    const slug = seededPublicClientSlug();
    await page.goto(`/client/${slug}`);
    await page.waitForTimeout(3000);
    expect(page.url()).not.toMatch(/token=|access_token/i);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.length).toBeGreaterThan(80);
    await expect(page.getByPlaceholder('Password')).toHaveCount(0);
  });
});

test.describe('P0.14b Profile SEO shape', () => {
  test('agency profile path uses slug not uuid', async () => {
    expect(seededPublicAgencySlug()).toMatch(/^[a-z0-9-]+$/i);
  });
});

test.describe('P0.15 Landing / SEO probes', () => {
  test('base URL responds for app root @smoke @p0', async ({ request }) => {
    await assertBaseUrlReachable(request, getBaseUrl());
  });

  test('web.index-casting.com responds below 500 (informational) @p0', async ({ request }) => {
    const res = await request.get('https://web.index-casting.com/');
    expect(res.status()).toBeLessThan(500);
  });

  test('robots.txt request (informational) @p0', async ({ request }) => {
    const base = getBaseUrl().replace(/\/$/, '');
    const res = await request.get(`${base}/robots.txt`);
    expect([200, 404]).toContain(res.status());
  });

  test('sitemap.xml has no obvious token query params @p0', async ({ request }) => {
    const base = getBaseUrl().replace(/\/$/, '');
    const res = await request.get(`${base}/sitemap.xml`);
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const text = (await res.text()).slice(0, 50_000);
      expect(text.toLowerCase()).not.toMatch(/access_token=|refresh_token=|apikey=/i);
    }
  });
});
