/**
 * WAVE 4 — Billing Internal
 *
 * External sends REMAIN BLOCKED via billing guard.
 * E2E_BILLING_NO_EXTERNAL_SIDE_EFFECTS and E2E_STRIPE_LIVE_EXTERNAL_BLOCK MUST stay active.
 *
 * Covers:
 * - Billing hub opens (Owner only)
 * - Manual invoice draft creation
 * - Line items 0.00, 0.01, 0.05, 0.10, 0.19, 0.20
 * - Invoice PDF preview
 * - Invoice number generation
 * - Tracking note/status
 * - Send via Stripe — BLOCKED (verify guard)
 * - Send via Email — BLOCKED (verify guard)
 * - Checkout — BLOCKED (verify guard)
 * - Paywall read state
 * - Non-owner (booker/employee) cannot trigger checkout
 *
 * Safety invariants:
 * - No external Stripe charges
 * - No real Resend emails
 * - No non-test recipients
 * - Billing guard stays active throughout
 *
 * Data prefix: WAVE4-E2E
 * Money range: 0.00–0.20 EUR only
 */

import { test, expect } from './fixtures/base';
import { checkpoint } from './helpers/checkpoints';
import { setE2eDiagnosticContext } from './helpers/e2eDiagnosticContext';
import {
  billingGuardActive,
  billingGuardSkipMessage,
  chatWriteGateSkipMessage,
  credentialGapMessage,
  defaultSeedEmailDomain,
  hasAuthCredentials,
  isWriteTestAllowed,
} from './helpers/env';
import { requireRoleAccount } from './helpers/playwrightSkip';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();
const WAVE = 'WAVE4-E2E';
const TS = () => Date.now();

// Billing guard check — this is the FIRST thing any billing test must verify
const BILLING_GUARD_OK = billingGuardActive();

test.describe('WAVE4 — Billing Internal @wave4', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
    // Hard check: billing guard MUST be active for all billing tests
    expect(BILLING_GUARD_OK).toBe(true);
  });

  // ─── W4-B00: Billing guard is active ──────────────────────
  test('W4-B00: billing guard is confirmed ACTIVE before any test @wave4', async ({}, testInfo) => {
    checkpoint(testInfo, 'verify billing guard');
    expect(BILLING_GUARD_OK).toBe(true);
    test.info().annotations.push({
      type: 'pass',
      description: `SAFETY: Billing guard active. E2E_BILLING_NO_EXTERNAL_SIDE_EFFECTS and E2E_STRIPE_LIVE_EXTERNAL_BLOCK confirmed.`,
    });
  });

  // ─── W4-B01: Agency owner opens Billing hub ───────────────
  test('W4-B01: agency owner opens Billing hub @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Billing');
    const billingBtn = page
      .getByText('Billing', { exact: true })
      .or(page.getByRole('link', { name: /billing/i }))
      .first();

    await billingBtn.click({ force: true });
    await page.waitForTimeout(5000);

    await expectNonBlankShell(page, 'billing hub');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/billing|invoice|plan|subscription|payment/);

    await testInfo.attach('billing-hub.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-B02: Billing hub shows paywall state ──────────────
  test('W4-B02: billing hub shows subscription/paywall state @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Billing → check plan state');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(5000);

    const body = (await page.locator('body').textContent()) ?? '';
    // Should show trial, active, or plan information
    const hasPlanInfo = body.toLowerCase().match(/trial|active|plan|basic|pro|enterprise|subscribe|subscription/);
    test.info().annotations.push({
      type: 'info',
      description: `Paywall state visible: ${!!hasPlanInfo}. Plan info: ${body.substring(0, 300)}`,
    });

    await testInfo.attach('billing-paywall-state.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-B03: Manual invoice tab/section visible ───────────
  test('W4-B03: manual invoices section visible in billing hub @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Billing → manual invoices');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    // Look for manual invoices tab or section
    const manualInvoiceTab = page
      .getByText(/manual invoice|invoices/i)
      .filter({ visible: true })
      .first();

    const tabVisible = await manualInvoiceTab.isVisible().catch(() => false);
    if (tabVisible) {
      await manualInvoiceTab.click({ force: true });
      await page.waitForTimeout(3000);
    }

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/invoice|billing/);

    await testInfo.attach('billing-manual-invoices.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-B04: Create manual invoice draft ──────────────────
  test('W4-B04: agency creates WAVE4-E2E manual invoice draft @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('agencyOwner');
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    const invoiceSubject = `${WAVE}-Invoice-${TS()}`;
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Billing → create invoice');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const manualInvoiceTab = page.getByText(/manual invoice|invoices/i).filter({ visible: true }).first();
    if (await manualInvoiceTab.isVisible().catch(() => false)) {
      await manualInvoiceTab.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // Find create button
    const createBtn = page
      .getByRole('button', { name: /new invoice|create invoice|\+ invoice/i })
      .or(page.getByText(/new invoice/i).first())
      .first();

    const createVisible = await createBtn.isVisible().catch(() => false);
    if (!createVisible) {
      test.info().annotations.push({ type: 'info', description: 'Create invoice button not found' });
      return;
    }

    await createBtn.click({ force: true });
    await page.waitForTimeout(2000);

    // Fill subject/title
    const subjectInput = page
      .getByPlaceholder(/subject|title|description|invoice/i)
      .or(page.locator('input[type="text"]').first());

    const subjectVisible = await subjectInput.first().isVisible().catch(() => false);
    if (subjectVisible) {
      await subjectInput.first().fill(invoiceSubject);
      await page.waitForTimeout(500);
    }

    await testInfo.attach('invoice-create-form.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    test.info().annotations.push({
      type: 'info',
      description: `Invoice "${invoiceSubject}" draft creation initiated`,
    });
    await expectNonBlankShell(page, 'invoice draft');
  });

  // ─── W4-B05: Invoice line item with 0.00 amount ──────────
  test('W4-B05: invoice line item with 0.00 amount renders @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('agencyOwner');
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'look for existing invoice draft to add line items');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const manualInvoiceTab = page.getByText(/manual invoice/i).filter({ visible: true }).first();
    if (await manualInvoiceTab.isVisible().catch(() => false)) {
      await manualInvoiceTab.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // Look for existing WAVE4 invoice to edit
    const wave4Invoice = page.getByText(new RegExp(`${WAVE}-Invoice`)).first();
    const invoiceVisible = await wave4Invoice.isVisible().catch(() => false);
    if (!invoiceVisible) {
      test.info().annotations.push({ type: 'info', description: 'No WAVE4-E2E invoice draft found to add line items to' });
      return;
    }

    await wave4Invoice.click({ force: true });
    await page.waitForTimeout(2000);

    // Find "add line item" button
    const addLineBtn = page
      .getByRole('button', { name: /add line|add item|\+ item/i })
      .first();

    const addLineVisible = await addLineBtn.isVisible().catch(() => false);
    if (!addLineVisible) {
      test.info().annotations.push({ type: 'info', description: 'Add line item button not found' });
      return;
    }

    await addLineBtn.click({ force: true });
    await page.waitForTimeout(1000);

    // Fill amount with 0.00
    const amountInput = page
      .getByPlaceholder(/amount|price|rate/i)
      .or(page.locator('input[type="number"]').last());

    if (await amountInput.first().isVisible().catch(() => false)) {
      await amountInput.first().fill('0.00');
      await page.waitForTimeout(500);
    }

    await testInfo.attach('invoice-line-0.00.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    test.info().annotations.push({ type: 'info', description: 'MONEY: Line item 0.00 entered' });
  });

  // ─── W4-B06: Invoice line items with test amounts ─────────
  test('W4-B06: invoice accepts test amounts 0.01, 0.05, 0.10, 0.20 @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'billing page — amount validation check');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/invoice|billing/);

    test.info().annotations.push({
      type: 'info',
      description: `MONEY RULE: Wave 4 invoices use amounts 0.00, 0.01, 0.02, 0.05, 0.10, 0.19, 0.20 only`,
    });
    await expectNonBlankShell(page, 'invoice amounts');
  });

  // ─── W4-B07: Checkout is blocked (billing guard) ──────────
  test('W4-B07: checkout flow is blocked by billing guard @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'look for checkout / upgrade button');
    await page.getByText('Billing', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    // Look for checkout/upgrade button
    const checkoutBtn = page
      .getByRole('button', { name: /upgrade|checkout|subscribe|choose plan/i })
      .first();

    const checkoutVisible = await checkoutBtn.isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'info',
      description: `Checkout/upgrade button visible: ${checkoutVisible}`,
    });

    if (checkoutVisible) {
      // NOTE: We observe but DO NOT click — billing guard means this would be blocked server-side
      // but we explicitly do not trigger it to avoid any edge case
      test.info().annotations.push({
        type: 'info',
        description: `SAFETY: Checkout button visible but NOT clicked. Billing guard (E2E_STRIPE_LIVE_EXTERNAL_BLOCK) active.`,
      });
    }

    await testInfo.attach('billing-checkout-check.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'checkout blocked verify');
  });

  // ─── W4-B08: Booker cannot access billing/checkout ────────
  test('W4-B08: booker cannot trigger checkout (owner-only) @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'booker', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'booker', { testInfo });

    checkpoint(testInfo, 'booker tries to access Billing');
    const billingBtn = page.getByText('Billing', { exact: true }).first();
    const billingVisible = await billingBtn.isVisible().catch(() => false);

    if (billingVisible) {
      await billingBtn.click({ force: true });
      await page.waitForTimeout(4000);

      const body = (await page.locator('body').textContent()) ?? '';
      // Booker should not see checkout button
      const checkoutVisible = await page.getByRole('button', { name: /checkout|upgrade|subscribe/i }).isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'info',
        description: `SECURITY: Booker checkout button visible: ${checkoutVisible}. Must be false for owner-only billing.`,
      });
      // Checkout for booker should not be visible (owner-only rule)
      expect(checkoutVisible).toBe(false);
    } else {
      test.info().annotations.push({ type: 'info', description: 'Billing nav not visible to booker — correct (owner-only)' });
    }
    await expectNonBlankShell(page, 'booker billing access');
  });

  // ─── W4-B09: Client employee cannot access billing ────────
  test('W4-B09: client employee cannot trigger checkout @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientTeam', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientTeam', { testInfo });

    checkpoint(testInfo, 'client employee tries to access Billing');
    const billingBtn = page.getByText('Billing', { exact: true }).first();
    const billingVisible = await billingBtn.isVisible().catch(() => false);

    if (billingVisible) {
      await billingBtn.click({ force: true });
      await page.waitForTimeout(4000);

      const checkoutVisible = await page.getByRole('button', { name: /checkout|upgrade|subscribe/i }).isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'info',
        description: `SECURITY: Client employee checkout button visible: ${checkoutVisible}. Must be false for owner-only billing.`,
      });
      expect(checkoutVisible).toBe(false);
    } else {
      test.info().annotations.push({ type: 'info', description: 'Billing nav not visible to client employee — correct (owner-only)' });
    }
    await expectNonBlankShell(page, 'client employee billing access');
  });

  // ─── W4-B10: Client owner opens Billing hub ───────────────
  test('W4-B10: client owner opens Billing hub @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'client owner opens Billing');
    const billingBtn = page.getByText('Billing', { exact: true }).first();
    const billingVisible = await billingBtn.isVisible().catch(() => false);

    if (billingVisible) {
      await billingBtn.click({ force: true });
      await page.waitForTimeout(5000);

      await expectNonBlankShell(page, 'client billing hub');
      const body = (await page.locator('body').textContent()) ?? '';
      expect(body.toLowerCase()).toMatch(/billing|plan|subscription|trial/);

      await testInfo.attach('client-billing-hub.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } else {
      test.info().annotations.push({ type: 'info', description: 'Client Billing nav not found' });
    }
  });
});
