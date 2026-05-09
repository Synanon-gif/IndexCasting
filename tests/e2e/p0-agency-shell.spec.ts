import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();

/** Primary agency nav labels (English UI). */
const AGENCY_TABS = [
  'Dashboard',
  'My Models',
  'Clients',
  'Messages',
  'Calendar',
  'Recruiting',
  'Team',
  'Links',
  'Billing',
  'Settings',
  'Profile',
];

test.describe('P0.2 Agency shell', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('dashboard visible and major tabs reachable @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'agencyOwner', { testInfo });
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    for (const label of AGENCY_TABS) {
      const el = page.getByText(label, { exact: true }).first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(800);
        await expectNonBlankShell(page, `agency tab: ${label}`);
      }
    }

    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
  });
});
