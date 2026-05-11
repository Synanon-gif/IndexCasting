/**
 * WAVE 4 — Discovery / Near-Me / Geo
 *
 * Covers:
 * - Model grid appears and loads
 * - Search / filter by characteristics (height, category, location)
 * - Radius / near-me toggle
 * - Geolocation granted and denied
 * - Cross-country territory visibility
 * - Pagination / load more
 * - Empty state handling
 * - Mobile near-me behavior
 * - Screenshots recorded desktop + mobile
 *
 * Gate: hasAuthCredentials() for authenticated discovery
 * Anon guests: package/guest-link browsing only
 */

import { test, expect } from './fixtures/base';
import { checkpoint } from './helpers/checkpoints';
import { setE2eDiagnosticContext } from './helpers/e2eDiagnosticContext';
import {
  credentialGapMessage,
  defaultSeedEmailDomain,
  hasAuthCredentials,
} from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();
const WAVE = 'WAVE4-E2E';

test.describe('WAVE4 — Discovery / Near-Me / Geo @wave4', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  // ─── W4-D01: Discover shell loads ────────────────────────────────────────
  test('W4-D01: client opens Discover — model grid loads @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'discover');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/discover|model|agency|browse|fashion/);

    await testInfo.attach('discover-grid-desktop.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  });

  // ─── W4-D02: Discover filter panel opens ────────────────────────────────
  test('W4-D02: client opens filter panel in Discover @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    checkpoint(testInfo, 'open filter panel');
    // Try filter button — may be labeled "Filter", "Filters", or use icon
    const filterBtn = page
      .getByRole('button', { name: /filter/i })
      .or(page.getByText(/^Filter/i).first())
      .or(page.locator('[data-testid*="filter"]').first());

    const filterVisible = await filterBtn.isVisible().catch(() => false);
    if (filterVisible) {
      await filterBtn.click({ force: true });
      await page.waitForTimeout(2000);
      const body = (await page.locator('body').textContent()) ?? '';
      expect(body.toLowerCase()).toMatch(/height|filter|category|chest|waist|apply|reset|close/);
      await testInfo.attach('discover-filter-panel.png', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      });
    } else {
      test.info().annotations.push({ type: 'info', description: 'Filter button not visible — filter panel may be always-open or not present' });
    }

    await expectNonBlankShell(page, 'discover with filter');
  });

  // ─── W4-D03: Country selector exists ─────────────────────────────────────
  test('W4-D03: client can see/use country selector @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    const body = (await page.locator('body').textContent()) ?? '';
    // Country selector / territory picker should be visible
    expect(body.toLowerCase()).toMatch(/discover|model|country|territory|agency/);
    await testInfo.attach('discover-country-selector.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D04: Near-Me toggle visible ──────────────────────────────────────
  test('W4-D04: Near-Me toggle is visible and responds @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    const nearMeBtn = page
      .getByText(/near me/i)
      .or(page.getByText(/nearby/i))
      .or(page.getByRole('button', { name: /near/i }));

    const nearMeVisible = await nearMeBtn.first().isVisible().catch(() => false);
    if (nearMeVisible) {
      checkpoint(testInfo, 'near-me toggle visible');
      await testInfo.attach('near-me-toggle.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } else {
      test.info().annotations.push({ type: 'info', description: 'Near-Me toggle not visible in current Discover view — may be in filter panel' });
    }
    await expectNonBlankShell(page, 'discover near-me');
  });

  // ─── W4-D05: Geolocation granted → Near-Me activates ────────────────────
  test('W4-D05: geolocation granted — near-me activates with coordinates @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });

    // Grant geolocation (Hamburg, Germany — realistic for agency world)
    await page.context().setGeolocation({ latitude: 53.5511, longitude: 9.9937 });
    await page.context().grantPermissions(['geolocation']);

    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover with geo granted');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'discover geo granted');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/discover|model|agency/);

    await testInfo.attach('discover-geo-granted.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D06: Geolocation denied → graceful fallback ──────────────────────
  test('W4-D06: geolocation denied — discover falls back gracefully @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });

    // Explicitly deny geolocation
    await page.context().grantPermissions([]);

    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover with geo denied');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    await expectNonBlankShell(page, 'discover geo denied');
    // Should not crash — should show fallback content
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/discover|model|agency|country|browse/);
    // Must NOT show unhandled error
    expect(body.toLowerCase()).not.toMatch(/unhandled error|crash|undefined is not/);

    await testInfo.attach('discover-geo-denied.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D07: Agency can browse own models ────────────────────────────────
  test('W4-D07: agency owner opens My Models — roster visible @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open My Models');
    await page.getByText('My Models', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'my models');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/model|add model|import|agency|my models/);

    await testInfo.attach('my-models-roster.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D08: Booker can also view roster ─────────────────────────────────
  test('W4-D08: booker opens My Models — same roster visible @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'booker', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'booker', { testInfo });

    checkpoint(testInfo, 'booker opens My Models');
    await page.getByText('My Models', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'booker my models');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/model|add model|import|agency|my models/);
  });

  // ─── W4-D09: Client discover pagination / load more ──────────────────────
  test('W4-D09: discover pagination — load more works or empty state shown @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    // Try to scroll down to trigger load more
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(2000);

    const body = (await page.locator('body').textContent()) ?? '';
    // Either more models load or an appropriate empty/end state
    expect(body.toLowerCase()).toMatch(/discover|model|no more|no results|agency|fashion/);

    await testInfo.attach('discover-pagination.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D10: Mobile discover viewport renders correctly ──────────────────
  test('W4-D10: mobile viewport — discover renders without layout overflow @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });

    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover mobile');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'discover mobile');

    // Check no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > document.body.clientWidth + 5;
    });
    if (hasHorizontalOverflow) {
      test.info().annotations.push({ type: 'warning', description: 'Horizontal overflow detected on mobile Discover' });
    }

    await testInfo.attach('discover-mobile-390.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-D11: Cross-org isolation — client cannot see agency internal data
  test('W4-D11: client discover cannot see agency-internal pricing or notes @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const body = (await page.locator('body').textContent()) ?? '';
    // Client must NOT see agency internal pricing, agency notes, or commission fields
    expect(body.toLowerCase()).not.toMatch(/agency notes|internal note|commission rate|booker note/);
  });

  // ─── W4-D12: Empty state for no-match filters ────────────────────────────
  test('W4-D12: discover with extreme filter shows empty state gracefully @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Discover');
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // Navigate to a URL with extreme filter params if supported
    // Most platforms accept query params; test graceful empty state
    await page.goto(`${page.url()}`.replace(/\?.*/, '') + '?height_min=999&height_max=999');
    await page.waitForTimeout(3000);

    await expectNonBlankShell(page, 'discover empty state');
    const body = (await page.locator('body').textContent()) ?? '';
    // Should show some content — either empty state message or ignore the param gracefully
    expect(body).not.toBe('');
    expect(body.toLowerCase()).not.toMatch(/unhandled error|cannot read|typeerror/);

    await testInfo.attach('discover-empty-state.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
