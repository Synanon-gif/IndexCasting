import { test, expect } from './fixtures/base';
import { credentialGapMessage, emailForRole, hasAuthCredentials } from './helpers/env';
import { prepareAuthScreenForCredentialLogin, signInAs, signOutViaUi, submitAuthScreen } from './helpers/auth';

const needsCreds = hasAuthCredentials();

test.describe('P0.1 Auth flows', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('agency owner logs in @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'agencyOwner', { testInfo });
    const dashboard = page.getByText('Dashboard', { exact: true }).first();
    const logout = page.getByText(/^Logout$/i).filter({ visible: true }).first();
    const myModels = page
      .getByRole('tab', { name: /^My Models$/i })
      .or(page.getByText('My Models', { exact: true }).filter({ visible: true }));
    /** Union matches multiple visible nav nodes (Logout + Dashboard + tab); `.first()` avoids strict-mode violation. */
    await expect(dashboard.or(logout).or(myModels.first()).first()).toBeVisible();
  });

  test('client owner logs in @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    const dashboard = page.getByText('Dashboard', { exact: true }).first();
    const logout = page.getByText(/^Logout$/i).filter({ visible: true }).first();
    const discover = page
      .getByRole('tab', { name: /^Discover$/i })
      .or(page.getByText('Discover', { exact: true }).filter({ visible: true }));
    await expect(dashboard.or(logout).or(discover.first()).first()).toBeVisible();
  });

  test('linked model logs in @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'modelLinked', { testInfo });
    const home = page.getByText(/^Home$/).first();
    const termsGate = page.getByText(/I accept the Terms of Service/i).filter({ visible: true }).first();
    await expect(home.or(termsGate)).toBeVisible();
  });

  test('logout returns toward auth entry @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'agencyOwner', { testInfo });
    await signOutViaUi(page);
    const body = ((await page.locator('body').textContent()) ?? '').toLowerCase();
    expect(
      body.includes('email') ||
        body.includes('password') ||
        body.includes('login') ||
        body.includes('index casting'),
    ).toBe(true);
  });

  test('reload preserves session (client) @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'clientOwner', { testInfo });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const dashboard = page.getByText('Dashboard', { exact: true }).first();
    const logout = page.getByText(/^Logout$/i).filter({ visible: true }).first();
    const discover = page
      .getByRole('tab', { name: /^Discover$/i })
      .or(page.getByText('Discover', { exact: true }).filter({ visible: true }));
    await expect(dashboard.or(logout).or(discover.first()).first()).toBeVisible({
      timeout: 45_000,
    });
  });

  test('reload preserves session (agency) @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const dashboard = page.getByText('Dashboard', { exact: true }).first();
    const logout = page.getByText(/^Logout$/i).filter({ visible: true }).first();
    const myModels = page
      .getByRole('tab', { name: /^My Models$/i })
      .or(page.getByText('My Models', { exact: true }).filter({ visible: true }));
    await expect(dashboard.or(logout).or(myModels.first()).first()).toBeVisible({
      timeout: 45_000,
    });
  });

  test('reload preserves session (model) @p0', async ({ page }, testInfo) => {
    await signInAs(page, 'modelLinked', { testInfo });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const home = page.getByText(/^Home$/).first();
    const termsGate = page.getByText(/I accept the Terms of Service/i).filter({ visible: true }).first();
    await expect(home.or(termsGate)).toBeVisible({ timeout: 45_000 });
  });

  test('invalid credentials fail without crashing @p0', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await prepareAuthScreenForCredentialLogin(page);
    const emailPh = page.getByPlaceholder(/^(Email|E-mail|Email address)$/i).first();
    const passwordPh = page.getByPlaceholder(/^(Password|Passcode)$/i).first();
    await expect(emailPh).toBeVisible({ timeout: 20_000 });
    await emailPh.fill('e2e-invalid@index-casting.test');
    await passwordPh.fill('DefinitelyWrong#999999999');
    const clicked = await submitAuthScreen(page);
    if (!clicked) {
      await passwordPh.press('Enter').catch(() => undefined);
    }
    await expect
      .poll(async () => (await page.locator('[role="progressbar"], [aria-busy="true"]').count()) < 5, {
        timeout: 8_000,
      })
      .toBe(true);
    const spinners = page.locator('[role="progressbar"], [aria-busy="true"]');
    const spinnerCount = await spinners.count();
    expect(spinnerCount).toBeLessThan(5);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.length).toBeGreaterThan(50);
    await expect(emailPh).toBeVisible();
  });
});

test.describe('P0.1 Auth — email reminder', () => {
  test('documents default agency email when env not set', async () => {
    expect(emailForRole('agencyOwner')).toContain('e2e-agency-owner');
  });
});
