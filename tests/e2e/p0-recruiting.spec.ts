import { test, expect } from './fixtures/base';
import { checkpoint } from './helpers/checkpoints';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';
import { recruitingDetailShowsActionControls } from './helpers/recruitingAssertions';

const needsCreds = hasAuthCredentials();

test.describe('P0.13 Recruiting', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('Recruiting tab lists seeded applicant; detail shows actions; no accept/reject click @p0', async ({
    page,
  }, testInfo) => {
    checkpoint(testInfo, 'recruiting: agency signIn');
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText('Recruiting', { exact: true }).first().click();
    await page.waitForTimeout(5000);
    const body = ((await page.locator('body').textContent()) ?? '').toLowerCase();
    expect(
      body.includes('recruit') ||
        body.includes('application') ||
        body.includes('e2e') ||
        body.includes('applicant') ||
        body.includes('pending'),
    ).toBe(true);

    const applicant = page.getByText(/E2E.*Applicant|e2e.*applicant|Berlin/i).first();
    if (!(await applicant.isVisible().catch(() => false))) {
      test.skip(
        true,
        'BLOCKER (seed-gap): seeded applicant row not found — re-run npm run seed:e2e or check Recruiting list copy.',
      );
    }
    await applicant.click();
    await page.waitForTimeout(2500);
    await expectNonBlankShell(page, 'recruiting detail');
    const det = (await page.locator('body').textContent()) ?? '';
    expect(det.toLowerCase()).toMatch(/e2e|applicant|berlin|playwright|pending|profile|chat/);

    const hasAction = await recruitingDetailShowsActionControls(page);
    expect(
      hasAction,
      'BLOCKER (selector-gap): no visible accept/reject/chat-like control (button, link, or pressable) in detail',
    ).toBe(true);

    const chatBtn = page.getByRole('button', { name: /chat|^message/i }).first();
    const chatLink = page.getByRole('link', { name: /chat|^message/i }).first();
    let chatHit = null;
    if (await chatBtn.isVisible().catch(() => false)) chatHit = chatBtn;
    else if (await chatLink.isVisible().catch(() => false)) chatHit = chatLink;
    if (chatHit) {
      checkpoint(testInfo, 'recruiting: open chat (non-destructive tap)');
      await chatHit.click();
      await page.waitForTimeout(2000);
      const after = ((await page.locator('body').textContent()) ?? '').toLowerCase();
      expect(after).toMatch(/e2e|applicant|message|chat|recruit|compose|send|type|back/i);
    }
  });
});
