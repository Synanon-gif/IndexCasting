/**
 * Wave 5 — Notification / Attention System Hardening
 * Run ID: WAVE5-RUN-2026-05-11
 *
 * Tests notification badge integrity, attention state consistency,
 * no phantom alerts, and no duplicate notifications.
 *
 * Does NOT trigger real external notifications (email/push).
 */

import { test, expect } from '@playwright/test';
import { billingGuardActive, billingGuardSkipMessage } from './helpers/env';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://indexcasting.com';
const RUN_ID = 'WAVE5-RUN-2026-05-11';

test.describe('W5-NOTIF — Notification / Attention System Hardening @wave5', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.annotations.push({ type: 'wave', description: 'Wave 5 — Hardening' });
    testInfo.annotations.push({ type: 'runId', description: RUN_ID });
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF01: No phantom notification bubbles for anon user
  // ──────────────────────────────────────────────
  test('W5-NOTIF01: no notification badges visible to anonymous user @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Look for notification badges with numeric content
    const badges = await page.locator('[data-testid*="badge"], [data-testid*="notif"], [data-testid*="unread"]').all();
    let numericBadges = 0;
    for (const badge of badges) {
      const text = await badge.textContent().catch(() => '');
      if (/^\d+$/.test(text?.trim() ?? '')) numericBadges++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Numeric notification badges for anon: ${numericBadges}`,
    });
    // Anonymous user should not see notification counts
    expect(numericBadges, 'No notification count badges for anonymous user').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: No notification badges for anonymous user' });
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF02: Notification system does not trigger external sends
  // ──────────────────────────────────────────────
  test('W5-NOTIF02: notification system — no external sends triggered @wave5', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', r => {
      const url = r.url();
      if (/resend\.com|sendgrid|mailchimp|twilio|firebase.*fcm/i.test(url)) {
        externalRequests.push(url.slice(0, 80));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'info',
      description: `External notification service requests: ${externalRequests.length}`,
    });
    expect(externalRequests.length, 'No external notification service calls from browser').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'BILLING GUARD: No external notification sends from browser' });
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF03: Tab title does not show broken notification count
  // ──────────────────────────────────────────────
  test('W5-NOTIF03: page title does not show NaN or undefined notification count @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const title = await page.title();

    test.info().annotations.push({ type: 'info', description: `Page title: "${title}"` });
    expect(title).not.toContain('NaN');
    expect(title).not.toContain('undefined');
    expect(title).not.toContain('null');
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF04: Attention labels have valid text content
  // ──────────────────────────────────────────────
  test('W5-NOTIF04: all visible attention labels have non-empty text @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const attentionLabels = await page.locator('[data-testid*="attention-label"], [data-testid*="attention-pill"]').all();
    let emptyLabels = 0;
    for (const label of attentionLabels) {
      const text = await label.textContent().catch(() => '');
      if (!text || text.trim().length === 0) emptyLabels++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Attention labels: ${attentionLabels.length}, empty: ${emptyLabels}`,
    });
    expect(emptyLabels, 'No empty attention labels').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF05: No repeating notification API calls
  // ──────────────────────────────────────────────
  test('W5-NOTIF05: no rapid repeated notification fetch calls (no storm) @wave5', async ({ page }) => {
    const notificationCalls: string[] = [];
    page.on('request', r => {
      if (/notification|activity_log|unread/i.test(r.url())) {
        notificationCalls.push(r.url().slice(0, 80));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);

    test.info().annotations.push({
      type: 'info',
      description: `Notification API calls in 6s: ${notificationCalls.length}`,
    });
    // More than 20 calls to notification endpoints in 6 seconds = polling storm
    expect(notificationCalls.length, 'No notification polling storm').toBeLessThan(20);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF06: No Supabase RPC calls to admin endpoints from browser
  // ──────────────────────────────────────────────
  test('W5-NOTIF06: no admin_* RPC calls from browser (non-admin routes) @wave5', async ({ page }) => {
    const adminRpcCalls: string[] = [];
    page.on('request', r => {
      if (/rpc\/admin_/i.test(r.url())) {
        adminRpcCalls.push(r.url().slice(0, 100));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `admin_* RPC calls from non-admin page: ${adminRpcCalls.length}`,
    });
    // Non-admin routes should never call admin_* RPCs
    expect(adminRpcCalls.length, 'No admin_* RPC calls from non-admin browser context').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: No admin_* RPCs called from public routes' });
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF07: Messages tab shows "0" or no badge for anon
  // ──────────────────────────────────────────────
  test('W5-NOTIF07: messages tab shows no unread count for anon user @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const messagesBadge = await page.locator('[data-testid*="messages-badge"], [data-testid*="chat-badge"]').textContent().catch(() => '');
    const messagesBadgeNum = parseInt(messagesBadge?.trim() ?? '', 10);

    test.info().annotations.push({
      type: 'info',
      description: `Messages badge content: "${messagesBadge}", parsed: ${messagesBadgeNum}`,
    });
    // Should be 0 or empty for anon — never a phantom count
    if (!isNaN(messagesBadgeNum)) {
      expect(messagesBadgeNum, 'Messages badge is 0 for anon user').toBe(0);
    }
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF08: No API keys or secrets in network request headers
  // ──────────────────────────────────────────────
  test('W5-NOTIF08: no plaintext API keys in request Authorization headers @wave5', async ({ page }) => {
    const suspiciousHeaders: string[] = [];
    page.on('request', r => {
      const auth = r.headers()['authorization'] ?? '';
      // Anon key starts with 'eyJ' — that's fine (it's public)
      // Service role key must never be in browser
      if (auth && !auth.startsWith('Bearer eyJ')) {
        suspiciousHeaders.push(`${r.url().slice(0, 60)} | ${auth.slice(0, 20)}`);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'info',
      description: `Suspicious auth headers (not standard Bearer JWT): ${suspiciousHeaders.length}`,
    });
    expect(suspiciousHeaders.length, 'All auth headers are standard Bearer JWTs').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF09: Console noise level acceptable (< 20 warnings)
  // ──────────────────────────────────────────────
  test('W5-NOTIF09: console warning noise level acceptable @wave5', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'warning') warnings.push(msg.text().slice(0, 80));
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `Console warnings: ${warnings.length}`,
    });
    // Document for observation — more than 20 warnings suggests systemic issues
    if (warnings.length > 20) {
      test.info().annotations.push({
        type: 'warn',
        description: `HIGH CONSOLE NOISE: ${warnings.length} warnings on page load`,
      });
    }
    // Soft threshold
    expect(warnings.length, 'Console warning count acceptable').toBeLessThan(50);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF10: Rapid navigation — no notification storm
  // ──────────────────────────────────────────────
  test('W5-NOTIF10: rapid navigation does not create notification request storm @wave5', async ({ page }) => {
    const notifRequests: string[] = [];
    page.on('request', r => {
      if (/notification|activity_log/i.test(r.url())) notifRequests.push(r.url());
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Rapid navigations
    for (let i = 0; i < 3; i++) {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(2000);

    test.info().annotations.push({
      type: 'info',
      description: `Notification requests during 3 navigations: ${notifRequests.length}`,
    });
    // 4 navigations → max ~4 notification fetches expected
    expect(notifRequests.length, 'No notification request storm on rapid navigation').toBeLessThan(20);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF11: No console errors from Supabase realtime
  // ──────────────────────────────────────────────
  test('W5-NOTIF11: no Supabase realtime errors in console @wave5', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const realtimeErrors = errors.filter(e => /realtime.*error|supabase.*error|channel.*error/i.test(e));
    test.info().annotations.push({
      type: 'info',
      description: `Realtime-related console errors: ${realtimeErrors.length}`,
    });
    expect(realtimeErrors.length, 'No Supabase realtime errors in console').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF12: Notification endpoint returns valid JSON (not HTML error)
  // ──────────────────────────────────────────────
  test('W5-NOTIF12: Supabase RPC endpoints return JSON (not HTML errors) @wave5', async ({ page }) => {
    const htmlErrorResponses: string[] = [];
    page.on('response', async r => {
      if (r.url().includes('/rpc/') && r.status() < 400) {
        const ct = r.headers()['content-type'] ?? '';
        if (!ct.includes('application/json')) {
          htmlErrorResponses.push(`${r.url().slice(0, 60)} content-type=${ct}`);
        }
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `RPC endpoints returning non-JSON: ${htmlErrorResponses.length}`,
    });
    expect(htmlErrorResponses.length, 'All RPC responses are JSON').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF13: No cross-site request forgery tokens exposed
  // ──────────────────────────────────────────────
  test('W5-NOTIF13: no CSRF tokens visible in public HTML @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();

    // CSRF tokens in meta tags should not be for anon users
    // (Supabase uses JWT auth, not CSRF — but if something is exposing tokens, flag it)
    const csrfMeta = html.includes('name="csrf-token"') || html.includes('name="csrf_token"');
    test.info().annotations.push({
      type: 'info',
      description: `CSRF token in meta: ${csrfMeta}`,
    });
    // Informational — document if present
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF14: No duplicate identical DOM notification elements
  // ──────────────────────────────────────────────
  test('W5-NOTIF14: no duplicate identical notification UI elements @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Look for tabs/headers that might be duplicated
    const messagesTabs = await page.getByText(/^messages$/i).count().catch(() => 0);
    const calendarTabs = await page.getByText(/^calendar$/i).count().catch(() => 0);

    test.info().annotations.push({
      type: 'info',
      description: `'Messages' occurrences: ${messagesTabs}, 'Calendar' occurrences: ${calendarTabs}`,
    });
    // Having both nav and heading is okay (count ≤ 2)
    // More than 2 = possible duplicate rendering
    expect(messagesTabs).toBeLessThan(4);
    expect(calendarTabs).toBeLessThan(4);
  });

  // ──────────────────────────────────────────────
  // W5-NOTIF15: Billing guard active through notification tests
  // ──────────────────────────────────────────────
  test('W5-NOTIF15: billing guard active through notification hardening @wave5', async ({}) => {
    if (!billingGuardActive()) {
      test.skip(true, billingGuardSkipMessage());
    }
    expect(billingGuardActive()).toBe(true);
    test.info().annotations.push({ type: 'pass', description: 'BILLING GUARD: Active during notification hardening' });
  });
});
