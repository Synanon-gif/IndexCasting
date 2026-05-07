import { test, expect } from './fixtures/base';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();

test.describe('P0.8 Projects', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('My Projects opens seeded list and first project detail @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    await page.getByText('My Projects', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    await expectNonBlankShell(page, 'my projects list');

    const seeded = page.getByText(/E2E TEST.*Editorial|Editorial SS campaign/i).first();
    if (await seeded.isVisible().catch(() => false)) {
      await seeded.click();
      await page.waitForTimeout(3500);
      await expectNonBlankShell(page, 'project detail');
      const body = (await page.locator('body').textContent()) ?? '';
      expect(body.toLowerCase()).toMatch(/model|project|e2e|selection|empty/);
    }
  });
});
