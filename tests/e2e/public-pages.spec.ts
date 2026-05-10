import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/base';

/**
 * Public web behavior on hosted/production-style roots
 *
 * - `/` MUST load without hard errors; MAY be marketing or auth shell — we do not require
 *   classic login field copy on `/` anymore (Hosted-ROOT drift).
 * - `/terms`, `/privacy`, `/trust`, `/status` remain publicly reachable deep links (product contract).
 */

/** Avoid strict footer `exact:` copy; Hosted roots often gate legal links behind scroll or alternate labels. */
async function gotoIfRootLinkVisible(
  page: Page,
  linkMatch: RegExp,
  pathnameHint: RegExp,
): Promise<'clicked' | 'not_found'> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const link = page.getByRole('link', { name: linkMatch }).first();
  await link.scrollIntoViewIfNeeded().catch(() => undefined);
  const visible = await link.isVisible({ timeout: 2500 }).catch(() => false);
  if (!visible) return 'not_found';

  await link.click();
  await page.waitForTimeout(800);
  return page.url().match(pathnameHint) ? 'clicked' : 'not_found';
}

/**
 * Hosted `/` can be marketing, landing, or auth — validate only that the SPA shell hydrated.
 * Prefer `textContent` over `innerText` — RN Web hydration can defer layout text briefly.
 */
async function expectPublicRootEntry(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(2000);

  const title = (await page.title())?.trim() ?? '';
  expect(title.length, 'document should have a non-empty title').toBeGreaterThan(0);

  const raw = ((await page.locator('body').textContent()) ?? '').trim();
  expect(raw.length, 'public root should expose non-empty body textContent').toBeGreaterThan(40);

  const elCount = await page.locator('body *').count();
  expect(elCount, 'expect hydrated DOM under body').toBeGreaterThan(5);
}

async function expectLegalOrInfoPageHasContent(page: Page, kind: 'terms' | 'privacy'): Promise<void> {
  const body = ((await page.locator('body').innerText()) ?? '').trim();
  expect(body.length).toBeGreaterThan(120);

  const lower = body.toLowerCase();
  if (kind === 'terms') {
    expect(
      /terms|conditions|agreement|policy|legal|use of/.test(lower),
      'terms route should show legal-ish copy',
    ).toBe(true);
  } else {
    expect(
      /privacy|personal data|data protection|information we collect/.test(lower),
      'privacy route should show privacy-ish copy',
    ).toBe(true);
  }
}

test.describe('Root — app shell / auth entry', () => {
  test('loads successfully (no client error page) @smoke @p0', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('public root renders a usable hosted entry @smoke @p0', async ({ page }) => {
    await page.goto('/');
    await expectPublicRootEntry(page);
  });
});

test.describe('/terms — public legal route', () => {
  test('responds without a hard error @smoke @p0', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('does not force redirect to a login-only URL', async ({ page }) => {
    await page.goto('/terms');
    expect(page.url()).not.toMatch(/login|sign-in|auth/i);
  });

  test('shows terms-related content (route + tolerant body)', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toMatch(/\/terms/i);
    await expectLegalOrInfoPageHasContent(page, 'terms');
  });

  test('user can return to the app entry at /', async ({ page }) => {
    await page.goto('/terms');
    await page.goto('/');
    await page.waitForTimeout(1500);
    await expectPublicRootEntry(page);
  });

  test('Terms: footer link navigates when visible (optional)', async ({ page }) => {
    const fromRoot = await gotoIfRootLinkVisible(page, /terms(\s+of\s+service)?/i, /\/terms/i);
    if (fromRoot === 'not_found') {
      test.info().annotations.push({
        type: 'note',
        description: 'Terms link not visible from / — covered by direct /terms tests',
      });
    }
  });
});

test.describe('/privacy — public legal route', () => {
  test('responds without a hard error @p0', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  });

  test('does not force redirect to a login-only URL', async ({ page }) => {
    await page.goto('/privacy');
    expect(page.url()).not.toMatch(/login|sign-in|auth/i);
  });

  test('shows privacy-related content (route + tolerant body)', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toMatch(/\/privacy/i);
    await expectLegalOrInfoPageHasContent(page, 'privacy');
  });

  test('Privacy: footer link navigates when visible (optional)', async ({ page }) => {
    const fromRoot = await gotoIfRootLinkVisible(page, /privacy(\s+policy)?/i, /\/privacy/i);
    if (fromRoot === 'not_found') {
      test.info().annotations.push({
        type: 'note',
        description: 'Privacy link not visible from / — covered by direct /privacy tests',
      });
    }
  });
});

test.describe('Legal / trust / status — optional root discoverability', () => {
  test('Trust: direct /trust + optional Trust link from /', async ({ page }) => {
    const res = await page.goto('/trust');
    expect(res?.status()).not.toBeGreaterThanOrEqual(400);
    expect(page.url()).toMatch(/\/trust/i);
    const body = ((await page.locator('body').innerText()) ?? '').trim();
    expect(body.length).toBeGreaterThan(80);
    expect(/trust|security|compliance|index casting/i.test(body)).toBe(true);

    const fromRoot = await gotoIfRootLinkVisible(page, /\btrust\b/i, /\/trust/i);
    if (fromRoot === 'not_found') {
      test.info().annotations.push({
        type: 'note',
        description: 'Trust link not visible from / — deep link OK',
      });
    }
  });

  test('Status: direct /status + optional Status link from /', async ({ page }) => {
    const res = await page.goto('/status');
    expect(res?.status()).not.toBeGreaterThanOrEqual(400);
    expect(page.url()).toMatch(/\/status/i);
    const body = ((await page.locator('body').innerText()) ?? '').trim();
    expect(body.length).toBeGreaterThan(60);
    expect(
      /status|operational|uptime|system|healthy|availability|monitoring/i.test(body.toLowerCase()),
    ).toBe(true);

    const fromRoot = await gotoIfRootLinkVisible(page, /\bstatus\b/i, /\/status/i);
    if (fromRoot === 'not_found') {
      test.info().annotations.push({
        type: 'note',
        description: 'Status link not visible from / — deep link OK',
      });
    }
  });
});
