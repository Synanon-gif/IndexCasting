import { test, expect } from './fixtures/base';
import { checkpoint } from './helpers/checkpoints';
import { setE2eDiagnosticContext } from './helpers/e2eDiagnosticContext';
import {
  credentialGapMessage,
  defaultSeedEmailDomain,
  hasAuthCredentials,
  isWriteTestAllowed,
  optionLifecycleWriteGateSkipMessage,
} from './helpers/env';
import { requireRoleAccount } from './helpers/playwrightSkip';
import { signInAs, signOutViaUi } from './helpers/auth';

const needsCreds = hasAuthCredentials();

/**
 * Gated multi-role lifecycle. Fails loudly (with diagnostics) if a step’s control is missing — do not re-run on production.
 */
test.describe('P0.9c Option lifecycle — mutations (gated)', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
    test.skip(!isWriteTestAllowed('option_lifecycle'), optionLifecycleWriteGateSkipMessage());
  });

  test('linked option: agency confirms availability → model confirms → counter → client accepts → confirm job → calendar detail @p0', async ({
    page,
  }, testInfo) => {
    requireRoleAccount('agencyOwner');
    requireRoleAccount('clientOwner');
    requireRoleAccount('modelLinked');
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner+clientOwner+modelLinked',
      writeKind: 'option_lifecycle',
      emailDomainHint: defaultSeedEmailDomain(),
    });

    const counterAmount = String(2400 + (Date.now() % 200));

    /* ----- Agency: confirm availability ----- */
    checkpoint(testInfo, 'agency signIn');
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(3500);

    const optRow = page.getByText(/PLAYWRIGHT.*option test|Horizon lead/i).first();
    await expect(optRow).toBeVisible({
      timeout: 45_000,
      message: 'BLOCKER (selector-gap): seeded option row not in agency Messages',
    });
    await optRow.click();
    await page.waitForTimeout(3000);

    const confirmAvail = page.getByRole('button', { name: /^Confirm availability$/i });
    await expect(confirmAvail).toBeVisible({
      timeout: 25_000,
      message:
        'BLOCKER (selector-gap): Confirm availability not visible — seed state may already be past this step or UI chrome differs.',
    });
    await confirmAvail.click();
    await page.waitForTimeout(3000);
    await expect(
      page.getByText(/Agency confirmed availability|availability for this option/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    await signOutViaUi(page);
    await page.waitForTimeout(1500);

    /* ----- Model: confirm availability ----- */
    checkpoint(testInfo, 'model signIn');
    await signInAs(page, 'modelLinked', { testInfo });
    await page.getByText(/^Messages/).first().click();
    await page.waitForTimeout(3500);
    const modelRow = page.getByText(/PLAYWRIGHT|E2E TEST|option|Option|Horizon|Availability/i).first();
    await expect(modelRow).toBeVisible({
      timeout: 35_000,
      message: 'BLOCKER (selector-gap): model Messages has no row for seeded option',
    });
    await modelRow.click();
    await page.waitForTimeout(2500);

    const modelConfirm = page.getByRole('button', { name: /confirm availability|^confirm$/i }).first();
    await expect(modelConfirm).toBeVisible({
      timeout: 20_000,
      message:
        'BLOCKER (selector-gap): model confirm control not found (expected Confirm availability flow)',
    });
    await modelConfirm.click();
    await page.waitForTimeout(500);
    const alertConfirm = page.getByRole('button', { name: /^Confirm$/i }).last();
    if (await alertConfirm.isVisible().catch(() => false)) {
      await alertConfirm.click();
    }
    await page.waitForTimeout(4000);

    await signOutViaUi(page);
    await page.waitForTimeout(1500);

    /* ----- Agency: counter offer ----- */
    checkpoint(testInfo, 'agency counter');
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(2500);
    await page.getByText(/PLAYWRIGHT.*option test|Horizon lead/i).first().click();
    await page.waitForTimeout(2500);

    const acceptFee = page.getByRole('button', { name: /^Accept proposed fee$/i });
    const makeCounter = page.getByRole('button', { name: /Make counter offer/i });
    if (await acceptFee.isVisible().catch(() => false)) {
      await acceptFee.click();
      await page.waitForTimeout(2500);
    } else if (await makeCounter.isVisible().catch(() => false)) {
      await makeCounter.click();
      await page.waitForTimeout(800);
      const counterInput = page.getByPlaceholder(/Amount|counter|e\.g\./i).first();
      await expect(counterInput).toBeVisible({
        timeout: 15_000,
        message: 'BLOCKER (selector-gap): counter amount field not found',
      });
      await counterInput.fill(counterAmount);
      const sendCounter = page.getByRole('button', { name: /Send counter/i });
      await sendCounter.click();
      await page.waitForTimeout(3000);
    } else {
      throw new Error(
        'BLOCKER (selector-gap): neither Accept proposed fee nor Make counter offer visible after model confirm — price axis state unexpected',
      );
    }

    await signOutViaUi(page);
    await page.waitForTimeout(1500);

    /* ----- Client: accept agency proposal & confirm job ----- */
    checkpoint(testInfo, 'client finalize');
    await signInAs(page, 'clientOwner', { testInfo });
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(3000);
    const optTab = page.getByRole('button', { name: /option|requests|negotiation/i }).first();
    if (await optTab.isVisible().catch(() => false)) {
      await optTab.click();
      await page.waitForTimeout(1500);
    }
    await page.getByText(/PLAYWRIGHT.*option test|Horizon lead/i).first().click();
    await page.waitForTimeout(3500);

    const acceptProposal = page.getByRole('button', { name: /Accept agency proposal/i });
    if (await acceptProposal.isVisible().catch(() => false)) {
      await acceptProposal.click();
      await page.waitForTimeout(3000);
    }

    const confirmJob = page.getByRole('button', { name: /^Confirm job$/i });
    await expect(confirmJob).toBeVisible({
      timeout: 35_000,
      message:
        'BLOCKER (state/seed): Confirm job not available — both axes may not be satisfied; re-seed or inspect option_requests row.',
    });
    await confirmJob.click();
    await page.waitForTimeout(4000);
    await expect(page.getByText(/Job confirmed|confirmed by client/i).first()).toBeVisible({
      timeout: 25_000,
    });

    /* ----- Calendar: job visible + detail ----- */
    checkpoint(testInfo, 'client calendar');
    await page.getByText('Calendar', { exact: true }).first().click();
    await page.waitForTimeout(4000);
    for (const label of ['Month', 'Week', 'Day']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${label} view$`, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(900);
      }
    }
    const calHit = page
      .getByText(/job|E2E|PLAYWRIGHT|Option|showroom|fitting|Horizon/i)
      .first();
    await expect(calHit).toBeVisible({
      timeout: 25_000,
      message: 'BLOCKER (selector-gap): no calendar cell matched job/option title',
    });
    await calHit.click();
    await page.waitForTimeout(1500);
    const detailBody = (await page.locator('body').textContent()) ?? '';
    expect(detailBody.length).toBeGreaterThan(120);
  });
});
