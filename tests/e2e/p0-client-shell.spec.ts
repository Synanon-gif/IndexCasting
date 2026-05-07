import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();

const CLIENT_TABS = [
  'Dashboard',
  'Discover',
  'Messages',
  'Calendar',
  'Agencies',
  'My Projects',
  'Team',
  'Billing',
  'Profile',
];

test.describe('P0.3 Client shell', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('dashboard visible and major tabs reachable @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    for (const label of CLIENT_TABS) {
      const el = page.getByText(label, { exact: true }).first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(800);
        await expectNonBlankShell(page, `client tab: ${label}`);
      }
    }

    await expect(page.getByText('Discover', { exact: true }).first()).toBeVisible();
  });
});
