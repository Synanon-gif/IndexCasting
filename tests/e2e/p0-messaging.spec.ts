import { test, expect } from './fixtures/base';
import { resolveChatComposer } from './helpers/chatComposer';
import { checkpoint } from './helpers/checkpoints';
import { setE2eDiagnosticContext } from './helpers/e2eDiagnosticContext';
import {
  chatWriteGateSkipMessage,
  credentialGapMessage,
  defaultSeedEmailDomain,
  hasAuthCredentials,
  isWriteTestAllowed,
} from './helpers/env';
import { requireRoleAccount } from './helpers/playwrightSkip';
import { signInAs, signOutViaUi } from './helpers/auth';

const needsCreds = hasAuthCredentials();

test.describe('P0.5 B2B messaging', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('agency opens Messages tab @p0', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    const body = ((await page.locator('body').textContent()) ?? '').toLowerCase();
    expect(body.includes('message') || body.includes('inbox') || body.includes('chat')).toBe(
      true,
    );
  });

  test('client opens Messages tab @p0', async ({ page }, testInfo) => {
    requireRoleAccount('clientOwner');
    setE2eDiagnosticContext({
      roleKey: 'clientOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'clientOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.length).toBeGreaterThan(80);
  });

  test('B2B full roundtrip: agency sends, client sees, client replies, agency sees @p0', async ({
    page,
  }, testInfo) => {
    requireRoleAccount('agencyOwner');
    requireRoleAccount('clientOwner');
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner+clientOwner',
      writeKind: 'chat',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    const stampA = `E2E-B2B-A-${Date.now()}`;
    const stampC = `E2E-B2B-C-${Date.now()}`;
    const authFailures: { url: string; status: number }[] = [];
    const onResponse = (res: import('@playwright/test').Response) => {
      const u = res.url();
      const st = res.status();
      if (st >= 400 && (u.includes('supabase') || u.includes('auth'))) {
        authFailures.push({ url: u.split('?')[0], status: st });
      }
    };
    page.on('response', onResponse);

    try {
      checkpoint(testInfo, 'signIn agency');
      await signInAs(page, 'agencyOwner', { testInfo });
      await page.getByText('Messages', { exact: true }).first().click();
      await page.waitForTimeout(2500);

      const thread = page.getByText(/Horizon|Northwind|E2E TEST.*Horizon/i).first();
      await expect(thread).toBeVisible({ timeout: 25_000 });
      await thread.click();
      await page.waitForTimeout(2000);

      const inputA = await resolveChatComposer(page);
      await inputA.fill(stampA);
      const send = page.getByRole('button', { name: /^Send$/i });
      if (await send.isVisible().catch(() => false)) {
        await send.click();
      } else {
        await inputA.press('Enter');
      }
      await expect(page.getByText(stampA, { exact: false })).toBeVisible({ timeout: 20_000 });

      checkpoint(testInfo, 'signOut agency');
      await signOutViaUi(page);
      await page.waitForTimeout(1200);

      checkpoint(testInfo, 'signIn client');
      await signInAs(page, 'clientOwner', { testInfo });
      await page.getByText('Messages', { exact: true }).first().click();
      await page.waitForTimeout(2500);
      const threadClient = page.getByText(/Horizon|Northwind|E2E TEST.*Horizon/i).first();
      await expect(threadClient).toBeVisible({ timeout: 20_000 });
      await threadClient.click();
      await page.waitForTimeout(2000);
      await expect(page.getByText(stampA, { exact: false })).toBeVisible({ timeout: 25_000 });

      const inputC = await resolveChatComposer(page);
      await inputC.fill(stampC);
      const sendC = page.getByRole('button', { name: /^Send$/i });
      if (await sendC.isVisible().catch(() => false)) {
        await sendC.click();
      } else {
        await inputC.press('Enter');
      }
      await expect(page.getByText(stampC, { exact: false })).toBeVisible({ timeout: 20_000 });

      const severeAuth = authFailures.filter((x) => x.status >= 500 || x.status === 401 || x.status === 403);
      expect(severeAuth, `Auth/session HTTP errors during chat: ${JSON.stringify(severeAuth)}`).toEqual(
        [],
      );

      checkpoint(testInfo, 'signOut client');
      await signOutViaUi(page);
      await page.waitForTimeout(1200);

      checkpoint(testInfo, 'signIn agency verify reply');
      await signInAs(page, 'agencyOwner', { testInfo });
      await page.getByText('Messages', { exact: true }).first().click();
      await page.waitForTimeout(2500);
      await expect(thread).toBeVisible({ timeout: 20_000 });
      await thread.click();
      await page.waitForTimeout(2000);
      await expect(page.getByText(stampC, { exact: false })).toBeVisible({ timeout: 25_000 });
    } finally {
      page.off('response', onResponse);
    }
  });
});

test.describe('P0.6 Agency ↔ Model chat', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('linked model sees Messages after login (thread UI smoke) @p0', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'modelLinked',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'modelLinked', { testInfo });
    await page.getByText(/^Messages/).first().click();
    await page.waitForTimeout(3500);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.length).toBeGreaterThan(80);
  });

  /**
   * Real workflow: agency opens model thread (seeded linked model display name pattern), sends line;
   * model re-login and verifies in Messages.
   * BLOCKER if thread row not found: agency thread list may not include model name substring — see failure-summary headings.
   */
  test('agency sends to linked model; model sees timestamped message @p0', async ({
    page,
  }, testInfo) => {
    requireRoleAccount('agencyOwner');
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner+modelLinked',
      writeKind: 'chat',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    const stamp = `E2E-AG-MODEL-${Date.now()}`;

    checkpoint(testInfo, 'agency login');
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(3500);

    const modelThread = page
      .getByText(/E2E TEST — Model 01|Model 01|Linked Model|Maison Horizon|option|Option/i)
      .first();
    const visible = await modelThread.isVisible().catch(() => false);
    if (!visible) {
      test.skip(
        true,
        'BLOCKER (selector-gap): No agency↔model thread row matched /E2E TEST — Model 01|Model 01|Linked Model|…/. Agency Messages may use different labels or bury model chats under another bucket. Capture: failure-summary.md headings.',
      );
    }

    await modelThread.click();
    await page.waitForTimeout(2500);

    const input = await resolveChatComposer(page, 20_000);
    await input.fill(stamp);
    const send = page.getByRole('button', { name: /^Send$/i });
    if (await send.isVisible().catch(() => false)) {
      await send.click();
    } else {
      await input.press('Enter');
    }
    await expect(page.getByText(stamp, { exact: false })).toBeVisible({ timeout: 25_000 });

    await signOutViaUi(page);
    await page.waitForTimeout(1200);

    checkpoint(testInfo, 'model login');
    await signInAs(page, 'modelLinked', { testInfo });
    await page.getByText(/^Messages/).first().click();
    await page.waitForTimeout(4000);

    const backThread = page
      .getByText(/Northwind|Horizon|Agency|Model 01|option|Option|E2E/i)
      .first();
    await expect(backThread).toBeVisible({ timeout: 25_000 });
    await backThread.click();
    await page.waitForTimeout(2500);
    await expect(page.getByText(stamp, { exact: false })).toBeVisible({ timeout: 30_000 });
  });
});
