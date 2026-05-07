import { test } from './fixtures/base';
import { hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';

const needsCreds = hasAuthCredentials();

test.describe('P2 — Visual artifacts (no golden baseline)', () => {
  test('client discover — attach PNG @p2', async ({ page }, testInfo) => {
    test.skip(!needsCreds, 'Requires credentials');
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Screenshots: chromium desktop only');
    await signInAs(page, 'clientOwner', { testInfo });
    await page.getByText('Discover', { exact: true }).first().click();
    await page.waitForTimeout(3000);
    const buf = await page.screenshot({ fullPage: false });
    await testInfo.attach('p2-client-discover.png', {
      body: buf,
      contentType: 'image/png',
    });
  });
});
