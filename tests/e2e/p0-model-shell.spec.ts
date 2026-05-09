import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();

test.describe('P0.4 Model shell', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('home, calendar, messages, settings reachable @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'modelLinked', { testInfo });
    await expect(page.getByText(/^Home$/).first()).toBeVisible({ timeout: 30_000 });
    await expectNonBlankShell(page, 'model home');

    await page.getByText(/^Calendar$/).first().click();
    await page.waitForTimeout(900);
    await expectNonBlankShell(page, 'model calendar tab');

    await page.getByText(/^Messages/).first().click();
    await page.waitForTimeout(900);
    await expectNonBlankShell(page, 'model messages tab');

    await page.getByText(/^Settings$/).first().click();
    await page.waitForTimeout(900);
    await expectNonBlankShell(page, 'model settings tab');
  });
});
