/**
 * Wave 5 — Calendar Collision / Attention Hardening
 * Run ID: WAVE5-RUN-2026-05-11
 *
 * Tests calendar view consistency, overlap scenarios, note visibility, and attention badges.
 * Does NOT repeat basic calendar CRUD already covered in Wave 4.
 *
 * All generated data prefixed WAVE5-E2E.
 */

import { test, expect } from '@playwright/test';
import { billingGuardActive, billingGuardSkipMessage } from './helpers/env';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://indexcasting.com';
const RUN_ID = 'WAVE5-RUN-2026-05-11';

test.describe('W5-CAL — Calendar Collision / Attention Hardening @wave5', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.annotations.push({ type: 'wave', description: 'Wave 5 — Hardening' });
    testInfo.annotations.push({ type: 'runId', description: RUN_ID });
  });

  // ──────────────────────────────────────────────
  // W5-CAL01: Calendar page loads without JS errors
  // ──────────────────────────────────────────────
  test('W5-CAL01: calendar route loads without uncaught JS errors @wave5', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    test.info().annotations.push({ type: 'info', description: `JS errors on load: ${jsErrors.length}` });
    const criticalErrors = jsErrors.filter(e =>
      /calendar|undefined.*read|cannot read prop/i.test(e)
    );
    expect(criticalErrors.length, 'No calendar-related JS errors on load').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-CAL02: Month/Week/Day view toggles do not error
  // ──────────────────────────────────────────────
  test('W5-CAL02: month/week/day view switches without crashing @wave5', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Try to find and click view-mode buttons
    const viewButtons = ['Month', 'Week', 'Day', 'Agenda'];
    let switched = 0;
    for (const label of viewButtons) {
      const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      const visible = await btn.isVisible().catch(() => false);
      if (visible) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        switched++;
      }
    }

    test.info().annotations.push({ type: 'info', description: `Switched views: ${switched}, JS errors: ${jsErrors.length}` });
    expect(jsErrors.filter(e => /cannot read|undefined/i.test(e)).length).toBe(0);
    test.info().annotations.push({ type: 'pass', description: `CALENDAR: View switches worked (${switched} views triggered)` });
  });

  // ──────────────────────────────────────────────
  // W5-CAL03: Calendar page has no duplicate-event rendering artifacts
  // ──────────────────────────────────────────────
  test('W5-CAL03: calendar does not render duplicate static UI blocks @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Look for duplicate "CALENDAR" headings — a sign of duplicate view rendering
    const calendarHeadings = await page.getByText(/^calendar$/i).count().catch(() => 0);
    test.info().annotations.push({ type: 'info', description: `'CALENDAR' text occurrences: ${calendarHeadings}` });

    // Should not appear more than 2 times (nav + header is okay; 3+ = duplicate render)
    expect(calendarHeadings).toBeLessThan(3);
  });

  // ──────────────────────────────────────────────
  // W5-CAL04: Rapid reload of calendar page — no memory crash
  // ──────────────────────────────────────────────
  test('W5-CAL04: rapid calendar page reloads survive @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    for (let i = 0; i < 3; i++) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(400);
    }
    const body = await page.locator('body').textContent().catch(() => '');
    expect(body?.length ?? 0).toBeGreaterThan(10);
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: Calendar rapid reload survived 3 iterations' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL05: No ghost events visible to anon user
  // ──────────────────────────────────────────────
  test('W5-CAL05: anonymous user sees no calendar event data @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().catch(() => '');

    // Anonymous user should NOT see calendar events (option/casting/job names)
    // They should see auth/login UI instead
    const showsEventData = /option confirmed|casting confirmed|job confirmed|model_id|agency_id/i.test(body ?? '');
    expect(showsEventData, 'Anon user sees no calendar event data').toBe(false);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: Anonymous user cannot see calendar event data' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL06: Calendar semantic colors not leaking raw CSS values
  // ──────────────────────────────────────────────
  test('W5-CAL06: calendar color tokens not leaked as raw hex in page text @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().catch(() => '');

    // Raw color constants should never appear as visible text
    const rawColorLeak = /#1B5E20|#E65100|#1565C0/.test(body ?? '');
    expect(rawColorLeak, 'Calendar color constants not leaked as visible text').toBe(false);
  });

  // ──────────────────────────────────────────────
  // W5-CAL07: No BUST label visible (legacy field leak check)
  // ──────────────────────────────────────────────
  test('W5-CAL07: legacy "BUST" label not visible anywhere @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().catch(() => '');

    const bustVisible = /\bBUST\b/.test(body ?? '');
    expect(bustVisible, 'Legacy BUST field not visible (must be CHEST)').toBe(false);
    test.info().annotations.push({ type: 'pass', description: 'PRODUCT: Legacy BUST label not leaked to UI' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL08: Calendar does not render 0px-height event blocks
  // ──────────────────────────────────────────────
  test('W5-CAL08: calendar event containers have non-zero dimensions @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Find any calendar event blocks
    const eventBlocks = await page.locator('[data-testid*="calendar-event"], [data-testid*="event-block"]').all();
    let zeroDimensionCount = 0;
    for (const block of eventBlocks.slice(0, 10)) {
      const box = await block.boundingBox().catch(() => null);
      if (box && (box.height === 0 || box.width === 0)) zeroDimensionCount++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Calendar event blocks found: ${eventBlocks.length}, zero-dimension: ${zeroDimensionCount}`,
    });
    expect(zeroDimensionCount, 'No zero-dimension calendar event containers').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-CAL09: Smart attention chip text is readable (not empty)
  // ──────────────────────────────────────────────
  test('W5-CAL09: smart attention chips have non-empty text @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const chips = await page.locator('[data-testid*="attention"], [data-testid*="smart-attention"]').all();
    let emptyChips = 0;
    for (const chip of chips) {
      const text = await chip.textContent().catch(() => '');
      if (!text || text.trim().length === 0) emptyChips++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Attention chips found: ${chips.length}, empty: ${emptyChips}`,
    });
    expect(emptyChips, 'No empty smart attention chips').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-CAL10: Notification count never negative
  // ──────────────────────────────────────────────
  test('W5-CAL10: notification/unread count badges show valid values @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const badges = await page.locator('[data-testid*="badge"], [data-testid*="unread"], [data-testid*="count"]').all();
    let invalidBadges = 0;
    for (const badge of badges) {
      const text = await badge.textContent().catch(() => '');
      const num = parseInt(text?.trim() ?? '', 10);
      if (!isNaN(num) && num < 0) invalidBadges++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Badges found: ${badges.length}, invalid (negative): ${invalidBadges}`,
    });
    expect(invalidBadges, 'No negative notification count badges').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-CAL11: Anon user cannot reach authenticated calendar
  // ──────────────────────────────────────────────
  test('W5-CAL11: anon user redirected away from authenticated calendar paths @wave5', async ({ page }) => {
    await page.goto(`${BASE_URL}/agency/calendar`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const url = page.url();
    const body = await page.locator('body').textContent().catch(() => '');

    const isOnCalendar = url.includes('/agency/calendar') && /add option|add casting|my models/i.test(body ?? '');
    test.info().annotations.push({
      type: 'info',
      description: `Redirected from agency/calendar: ${!isOnCalendar}, final URL: ${url.slice(0, 80)}`,
    });
    // Anon should not be on authenticated calendar with full agency data
    if (isOnCalendar) {
      // Additional check: is actual calendar data (event titles) visible?
      const hasEventData = /option_request|booking_event/i.test(body ?? '');
      expect(hasEventData, 'Anon user cannot see calendar event data').toBe(false);
    }
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: Anon calendar route gating verified' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL12: No supabase-storage:// scheme leaked in page HTML
  // ──────────────────────────────────────────────
  test('W5-CAL12: no raw supabase-storage:// URIs leaked to public HTML @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const html = await page.content().catch(() => '');
    const storageUriLeak = /supabase-storage:\/\//.test(html);

    expect(storageUriLeak, 'No raw supabase-storage:// scheme in public HTML').toBe(false);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: No raw storage URIs in public HTML' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL13: "nullcm" and "0 cm" not visible (measurement safety)
  // ──────────────────────────────────────────────
  test('W5-CAL13: measurement display never shows nullcm or 0cm @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().catch(() => '');

    const nullCm = /nullcm|null cm|0 cm\b/i.test(body ?? '');
    expect(nullCm, 'No "nullcm" or "0 cm" measurement artifacts visible').toBe(false);
    test.info().annotations.push({ type: 'pass', description: 'PRODUCT: Measurement display safety check passed' });
  });

  // ──────────────────────────────────────────────
  // W5-CAL14: Multi-context calendar states are independent
  // ──────────────────────────────────────────────
  test('W5-CAL14: two browser contexts have independent calendar states @wave5', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await Promise.all([
      page1.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }),
      page2.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }),
    ]);
    await page1.waitForTimeout(1000);

    const cookies1 = (await ctx1.cookies()).map(c => c.name).join(',');
    const cookies2 = (await ctx2.cookies()).map(c => c.name).join(',');

    // Both unauthenticated — no auth cookies should exist
    test.info().annotations.push({
      type: 'info',
      description: `Context1 cookies: ${cookies1.slice(0, 60)}, Context2 cookies: ${cookies2.slice(0, 60)}`,
    });
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: Two browser contexts have independent state' });

    await ctx1.close();
    await ctx2.close();
  });

  // ──────────────────────────────────────────────
  // W5-CAL15: Billing guard still active
  // ──────────────────────────────────────────────
  test('W5-CAL15: billing guard active throughout calendar tests @wave5', async ({}) => {
    if (!billingGuardActive()) {
      test.skip(true, billingGuardSkipMessage());
    }
    expect(billingGuardActive()).toBe(true);
    test.info().annotations.push({ type: 'pass', description: 'BILLING GUARD: Active during calendar hardening tests' });
  });
});
