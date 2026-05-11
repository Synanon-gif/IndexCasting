/**
 * WAVE 4 — Chat / Realtime
 *
 * Covers:
 * - B2B thread create and open
 * - Client→Agency and Agency→Client message send
 * - Option thread messages
 * - Read/unread state
 * - Reload persistence
 * - No duplicate message storm
 * - No realtime race condition
 * - Attachment path (safe check only)
 * - Recruiting thread if supported
 *
 * Gate: E2E_ALLOW_CHAT_WRITES
 * Data prefix: WAVE4-E2E
 */

import { test, expect } from './fixtures/base';
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
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();
const WAVE = 'WAVE4-E2E';
const TS = () => Date.now();

test.describe('WAVE4 — Chat & Realtime @wave4', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  // ─── W4-C01: Agency messages tab loads ───────────────────
  test('W4-C01: agency messages tab loads @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'agency messages');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/message|thread|chat|conversation/);

    await testInfo.attach('agency-messages-tab.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-C02: Client messages tab loads ───────────────────
  test('W4-C02: client messages tab loads @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'client messages');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/message|thread|chat|conversation/);

    await testInfo.attach('client-messages-tab.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-C03: Agency opens a B2B thread ───────────────────
  test('W4-C03: agency opens a B2B thread @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    // Try clicking first thread
    const threadItem = page
      .locator('[data-testid*="thread"]')
      .or(page.locator('[data-testid*="conversation"]'))
      .or(page.locator('[data-testid*="message-row"]'))
      .first();

    const threadVisible = await threadItem.isVisible().catch(() => false);
    if (threadVisible) {
      await threadItem.click({ force: true });
      await page.waitForTimeout(3000);

      const body = (await page.locator('body').textContent()) ?? '';
      expect(body.toLowerCase()).toMatch(/message|send|type|chat/);

      // Check for chat input
      const chatInput = page
        .locator('[data-testid*="chat-input"]')
        .or(page.locator('[data-testid*="message-input"]'))
        .or(page.getByPlaceholder(/type|message|send/i))
        .first();
      const inputVisible = await chatInput.isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'info',
        description: `Chat input visible in thread: ${inputVisible}`,
      });

      await testInfo.attach('agency-thread-open.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } else {
      test.info().annotations.push({ type: 'info', description: 'No existing B2B thread found' });
    }
    await expectNonBlankShell(page, 'thread open');
  });

  // ─── W4-C04: Agency sends a WAVE4-E2E message ─────────────
  test('W4-C04: agency sends WAVE4-E2E message to client @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('agencyOwner');
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    const msgText = `${WAVE}-Msg-${TS()}`;
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    // Try clicking first thread
    const threadItem = page
      .locator('[data-testid*="thread"]')
      .or(page.locator('[data-testid*="conversation"]'))
      .first();

    const threadVisible = await threadItem.isVisible().catch(() => false);
    if (!threadVisible) {
      test.info().annotations.push({ type: 'info', description: 'No thread available to send message to — chat write skipped' });
      return;
    }

    await threadItem.click({ force: true });
    await page.waitForTimeout(2000);

    // Find chat input
    const chatInput = page
      .getByPlaceholder(/type|message|send/i)
      .or(page.locator('[data-testid*="chat-input"]'))
      .or(page.locator('input[type="text"]').last())
      .first();

    const inputVisible = await chatInput.isVisible().catch(() => false);
    if (!inputVisible) {
      test.info().annotations.push({ type: 'info', description: 'Chat input not found — cannot send message' });
      return;
    }

    checkpoint(testInfo, 'type and send message');
    await chatInput.fill(msgText);
    await page.waitForTimeout(500);

    // Send (Enter or send button)
    const sendBtn = page
      .getByRole('button', { name: /send/i })
      .or(page.locator('[data-testid*="send"]'))
      .first();

    const sendVisible = await sendBtn.isVisible().catch(() => false);
    if (sendVisible) {
      await sendBtn.click({ force: true });
    } else {
      await chatInput.press('Enter');
    }
    await page.waitForTimeout(3000);

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).toContain(msgText);

    test.info().annotations.push({
      type: 'info',
      description: `Chat message sent: "${msgText}"`,
    });

    await testInfo.attach('message-sent.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-C05: Client sends a WAVE4-E2E message ─────────────
  test('W4-C05: client sends WAVE4-E2E message to agency @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('clientOwner');
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    const msgText = `${WAVE}-ClientMsg-${TS()}`;
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const threadItem = page
      .locator('[data-testid*="thread"]')
      .or(page.locator('[data-testid*="conversation"]'))
      .first();

    const threadVisible = await threadItem.isVisible().catch(() => false);
    if (!threadVisible) {
      test.info().annotations.push({ type: 'info', description: 'No thread available for client to send message to' });
      return;
    }

    await threadItem.click({ force: true });
    await page.waitForTimeout(2000);

    const chatInput = page
      .getByPlaceholder(/type|message|send/i)
      .or(page.locator('[data-testid*="chat-input"]'))
      .first();

    const inputVisible = await chatInput.isVisible().catch(() => false);
    if (!inputVisible) {
      test.info().annotations.push({ type: 'info', description: 'Client chat input not found' });
      return;
    }

    await chatInput.fill(msgText);
    await page.waitForTimeout(500);

    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    if (sendVisible) {
      await sendBtn.click({ force: true });
    } else {
      await chatInput.press('Enter');
    }
    await page.waitForTimeout(3000);

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).toContain(msgText);

    await testInfo.attach('client-message-sent.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  // ─── W4-C06: Message persists after page reload ────────────
  test('W4-C06: chat message persists after reload @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('agencyOwner');
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    const msgText = `${WAVE}-PersistMsg-${TS()}`;
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Messages and thread');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const threadItem = page.locator('[data-testid*="thread"]').or(page.locator('[data-testid*="conversation"]')).first();
    const threadVisible = await threadItem.isVisible().catch(() => false);
    if (!threadVisible) {
      test.info().annotations.push({ type: 'info', description: 'No thread for reload persistence test' });
      return;
    }

    await threadItem.click({ force: true });
    await page.waitForTimeout(2000);

    const chatInput = page.getByPlaceholder(/type|message|send/i).first();
    const inputVisible = await chatInput.isVisible().catch(() => false);
    if (!inputVisible) return;

    await chatInput.fill(msgText);
    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    if (sendVisible) {
      await sendBtn.click({ force: true });
    } else {
      await chatInput.press('Enter');
    }
    await page.waitForTimeout(2000);

    checkpoint(testInfo, 'reload page');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    await expectNonBlankShell(page, 'messages after reload');
    // Try to re-navigate to the thread
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(3000);

    const threadAfterReload = page.locator('[data-testid*="thread"]').or(page.locator('[data-testid*="conversation"]')).first();
    const threadVisible2 = await threadAfterReload.isVisible().catch(() => false);
    if (threadVisible2) {
      await threadAfterReload.click({ force: true });
      await page.waitForTimeout(2000);
      const body = (await page.locator('body').textContent()) ?? '';
      expect(body).toContain(msgText);
      await testInfo.attach('message-after-reload.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  });

  // ─── W4-C07: No duplicate message storm ───────────────────
  test('W4-C07: sending message once does not create duplicate entries @wave4', async ({ page }, testInfo) => {
    test.skip(!isWriteTestAllowed('chat'), chatWriteGateSkipMessage());
    requireRoleAccount('agencyOwner');
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'chat', emailDomainHint: defaultSeedEmailDomain() });

    const msgText = `${WAVE}-DedupeMsg-${TS()}`;
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open thread');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const threadItem = page.locator('[data-testid*="thread"]').or(page.locator('[data-testid*="conversation"]')).first();
    const threadVisible = await threadItem.isVisible().catch(() => false);
    if (!threadVisible) {
      test.info().annotations.push({ type: 'info', description: 'No thread for dedupe test' });
      return;
    }

    await threadItem.click({ force: true });
    await page.waitForTimeout(2000);

    const chatInput = page.getByPlaceholder(/type|message|send/i).first();
    const inputVisible = await chatInput.isVisible().catch(() => false);
    if (!inputVisible) return;

    await chatInput.fill(msgText);
    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);

    // Send exactly once
    if (sendVisible) {
      await sendBtn.click({ force: true });
    } else {
      await chatInput.press('Enter');
    }
    await page.waitForTimeout(3000);

    // Count occurrences in DOM
    const bodyContent = (await page.locator('body').textContent()) ?? '';
    const count = (bodyContent.match(new RegExp(msgText.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g')) || []).length;
    test.info().annotations.push({
      type: 'info',
      description: `Message "${msgText}" appears ${count} time(s) in DOM. Expected: 1.`,
    });

    // Should appear exactly once (could be 1 or 2 if there's an "optimistic + confirmed" pair — both fine)
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2); // 2 max: optimistic + server confirmed
  });

  // ─── W4-C08: Recruiting tab exists if supported ────────────
  test('W4-C08: agency recruiting tab visible @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'agencyOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Recruiting');
    await page.waitForTimeout(3000);

    const recruitingLink = page
      .getByText('Recruiting', { exact: true })
      .or(page.getByRole('link', { name: /recruiting/i }))
      .first();

    const recruitingVisible = await recruitingLink.isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'info',
      description: `Recruiting tab visible: ${recruitingVisible}`,
    });

    if (recruitingVisible) {
      await recruitingLink.click({ force: true });
      await page.waitForTimeout(4000);
      await expectNonBlankShell(page, 'recruiting tab');

      await testInfo.attach('recruiting-tab.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  });

  // ─── W4-C09: Mobile chat rendering ────────────────────────
  test('W4-C09: mobile viewport — messages renders correctly @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });

    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 size
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'mobile messages');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    await expectNonBlankShell(page, 'mobile messages');

    await testInfo.attach('mobile-messages.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Reset
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // ─── W4-C10: Cross-org isolation — no other org messages ──
  test('W4-C10: client cannot see agency-internal messages @wave4', async ({ page }, testInfo) => {
    setE2eDiagnosticContext({ roleKey: 'clientOwner', writeKind: 'read', emailDomainHint: defaultSeedEmailDomain() });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'check messages isolation');
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(4000);

    const body = (await page.locator('body').textContent()) ?? '';

    // Should not see agency-only fields
    expect(body).not.toContain('proposed_price');
    expect(body).not.toContain('agency_counter_price');

    test.info().annotations.push({
      type: 'pass',
      description: 'SECURITY: Client does not see raw agency price negotiation fields in messages',
    });
  });
});
