import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import {
  SKIP_NO_DISCOVERY_SEED,
  assertSeededDiscoverLoaded,
  collectDiscoveryReadSnapshot,
  discoverFilterToggle,
  discoverHasSeededModels,
  ensureDiscoverFilterPanelClosed,
  ensureDiscoverFilterPanelOpen,
  expectDiscoverShellReady,
  markDiscoveryReadContext,
  openClientDiscover,
} from './helpers/discoveryRead';
import { checkpoint, clickAndCheckpoint, expectVisibleCheckpoint } from './helpers/checkpoints';

const needsCreds = hasAuthCredentials();

async function gotoDiscoverSignedIn(page: Page, testInfo: import('@playwright/test').TestInfo) {
  await signInAs(page, 'clientOwner', { testInfo });
  await clickAndCheckpoint(
    page.getByText('Discover', { exact: true }).first(),
    'Discover tab',
    testInfo,
  );
  await expectDiscoverShellReady(page);
}

test.describe('P0.7 Client discovery (read-only)', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
    markDiscoveryReadContext('clientOwner', 'index-casting.test');
  });

  test('Discover loads seeded grid, filter chrome, and read-only card drill-in @p0', async ({
    page,
  }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    const seeded = await discoverHasSeededModels(page);
    test.skip(!seeded, SKIP_NO_DISCOVERY_SEED);
    await assertSeededDiscoverLoaded(page);

    const cardish = page
      .locator('a, [role="button"]')
      .filter({ hasText: /e2e|playwright|cm\b|\d{2,3}/i })
      .first();
    if (await cardish.isVisible().catch(() => false)) {
      await clickAndCheckpoint(cardish, 'discover card / control', testInfo);
      await page.waitForTimeout(1200);
      const overlay = (await page.locator('body').textContent()) ?? '';
      expect(overlay.length).toBeGreaterThan(120);
    }
  });

  test('Discover filter panel opens and closes without Save filters @p0', async ({
    page,
  }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    await openClientDiscover(page);
    await expectDiscoverShellReady(page);

    await ensureDiscoverFilterPanelOpen(page);
    await expectVisibleCheckpoint(
      page.getByText('Height (cm)', { exact: true }).first(),
      'Height filter section',
      testInfo,
    );
    await expect(page.getByText('Save filters', { exact: true }).first()).toBeVisible();

    await ensureDiscoverFilterPanelClosed(page);
    await expect(page.getByText('Height (cm)', { exact: true }).first()).toBeHidden({
      timeout: 10_000,
    });
  });

  test('Discover Female filter shows banner; Reset clears (no Save) @p0', async ({
    page,
  }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    const seeded = await discoverHasSeededModels(page);
    test.skip(!seeded, SKIP_NO_DISCOVERY_SEED);
    await assertSeededDiscoverLoaded(page);

    await ensureDiscoverFilterPanelOpen(page);
    await clickAndCheckpoint(page.getByText('Female', { exact: true }).first(), 'Female', testInfo);
    await expect(page.getByText('Filtered by:', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText('Already seen models hidden', { exact: true }).first(),
    ).toBeVisible();
    await expect(discoverFilterToggle(page)).toHaveText(/Filter\s*\(\d+\)/);

    await clickAndCheckpoint(page.getByText('Reset', { exact: true }).first(), 'Reset', testInfo);
    await expect(page.getByText('Filtered by:', { exact: true }).first()).toBeHidden({
      timeout: 10_000,
    });
    await expect(discoverFilterToggle(page)).toHaveText(/^Filter$/);
  });

  test('Discover impossible height range yields empty read state @p0', async ({ page }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    const seeded = await discoverHasSeededModels(page);
    test.skip(!seeded, SKIP_NO_DISCOVERY_SEED);
    await assertSeededDiscoverLoaded(page);

    await ensureDiscoverFilterPanelOpen(page);
    await page.getByPlaceholder('From').first().fill('250');
    await page.getByPlaceholder('To').first().fill('260');
    await checkpoint(testInfo, 'height filter 250–260 (expect empty)');

    const emptyish = page
      .getByText('No more models right now.', { exact: true })
      .or(page.locator('text=/^0\\/0$/').first());
    await expect(emptyish.first()).toBeVisible({ timeout: 25_000 });

    await clickAndCheckpoint(page.getByText('Reset', { exact: true }).first(), 'Reset', testInfo);
    await assertSeededDiscoverLoaded(page);
  });

  test('Discover city substring filter read smoke (no Save) @p0', async ({ page }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    const seeded = await discoverHasSeededModels(page);
    test.skip(!seeded, SKIP_NO_DISCOVERY_SEED);
    await assertSeededDiscoverLoaded(page);

    await ensureDiscoverFilterPanelOpen(page);
    const city = page.getByPlaceholder(/e\.g\.\s*Berlin/i).first();
    await city.fill('___e2e_no_match_city___');
    await checkpoint(testInfo, 'city filter no-match');
    const emptyish = page
      .getByText('No more models right now.', { exact: true })
      .or(page.locator('text=/^0\\/0$/').first());
    await expect(emptyish.first()).toBeVisible({ timeout: 25_000 });

    await clickAndCheckpoint(page.getByText('Reset', { exact: true }).first(), 'Reset', testInfo);
    await assertSeededDiscoverLoaded(page);
  });

  test('Discover scroll + tab switch keeps shell readable @p0', async ({ page }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    await expectDiscoverShellReady(page);

    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(600);

    await clickAndCheckpoint(
      page.getByText('Dashboard', { exact: true }).first(),
      'Dashboard tab',
      testInfo,
    );
    await clickAndCheckpoint(
      page.getByText('Discover', { exact: true }).first(),
      'Discover tab again',
      testInfo,
    );
    await expectDiscoverShellReady(page);
  });

  test('Discover diagnostics snapshot attachment helper is non-empty on demand @p0', async ({
    page,
  }, testInfo) => {
    await gotoDiscoverSignedIn(page, testInfo);
    await expectDiscoverShellReady(page);
    const snap = await collectDiscoveryReadSnapshot(page);
    expect(snap.pathname).toBeTruthy();
    expect(snap.filterTriggerSample).toBeTruthy();
    await testInfo.attach('discovery-snapshot-smoke.json', {
      body: Buffer.from(JSON.stringify(snap, null, 2)),
      contentType: 'application/json',
    });
  });
});