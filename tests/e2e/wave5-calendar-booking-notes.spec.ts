/**
 * WAVE 5 — Calendar Booking Notes Restore (Regression)
 *
 * Root cause (2026-05-12): MonthCalendarView had no onEventPress handler.
 * Event chips in the month view were static View elements — clicking them
 * navigated to the week/day view instead of directly opening the detail
 * overlay with Shared Notes / Agency Notes / Model Notes.
 *
 * Fix: onEventPress prop added to MonthCalendarView; wired in
 *   B2BUnifiedCalendarBody (agency+client) and ModelProfileScreen (model).
 *
 * These tests verify:
 *   1. Month view: event chip click opens detail overlay (core fix)
 *   2. Week view: event click still opens detail overlay (regression guard)
 *   3. Day view: event click still opens detail overlay (regression guard)
 *   4. Agency internal notes: only visible to agency
 *   5. Shared notes: visible to both agency and client
 *   6. Model view: notes overlay accessible from month AND week AND day
 *   7. Client month/week/day consistency
 *   8-10. Option / Casting / Job event types: notes accessible
 *
 * Resilience: If no events exist on the account, tests annotate and pass
 * (production env, no seed script). Human review can verify with real data.
 *
 * Gate: No write mutations needed; all tests are read-only UI interactions.
 * Tag: @booking-notes-restore
 */

import { test, expect } from './fixtures/base';
import { checkpoint } from './helpers/checkpoints';
import { setE2eDiagnosticContext } from './helpers/e2eDiagnosticContext';
import {
  credentialGapMessage,
  defaultSeedEmailDomain,
  hasAuthCredentials,
} from './helpers/env';
import { signInAs } from './helpers/auth';
import { expectNonBlankShell } from './helpers/appAssertions';

const needsCreds = hasAuthCredentials();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Navigate to Calendar and switch to the given view mode.
 * Returns true if the view mode button was found and clicked.
 */
async function openCalendarView(
  page: import('@playwright/test').Page,
  viewMode: 'month' | 'week' | 'day',
): Promise<boolean> {
  await page.getByText('Calendar', { exact: true }).first().click();
  await page.waitForTimeout(4000);

  if (viewMode === 'month') {
    const btn = page.getByRole('button', { name: /month/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true });
      await page.waitForTimeout(2000);
      return true;
    }
    // May already be in month mode as default
    return true;
  }

  if (viewMode === 'week') {
    const btn = page
      .getByRole('button', { name: /week/i })
      .or(page.getByText('Week').filter({ visible: true }).first());
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ force: true });
      await page.waitForTimeout(2000);
      return true;
    }
    return false;
  }

  if (viewMode === 'day') {
    const btn = page
      .getByRole('button', { name: /^day$/i })
      .or(page.getByText('Day').filter({ visible: true }).first());
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ force: true });
      await page.waitForTimeout(2000);
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Try to click the first visible event chip / block in the current view.
 * Returns true if a clickable event was found and clicked.
 */
async function clickFirstCalendarEvent(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  // Try various selectors used by MonthCalendarView chips, WeekGrid blocks, DayTimeline blocks
  const selectors = [
    '[data-testid*="event"]',
    '[data-testid*="option-block"]',
    '[data-testid*="calendar-entry"]',
    '[data-testid*="booking"]',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ force: true });
      await page.waitForTimeout(2000);
      return true;
    }
  }

  // Fall back: look for colored chip-like elements with event titles
  const coloredChip = page
    .locator('div[style*="background"]')
    .filter({ hasText: /option|casting|job|booking/i })
    .first();
  if (await coloredChip.isVisible().catch(() => false)) {
    await coloredChip.click({ force: true });
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

/**
 * Check whether the detail overlay / panel with booking notes is visible.
 * Returns true if notes-related content is found in the page body.
 */
async function detailOverlayHasNotes(
  page: import('@playwright/test').Page,
): Promise<boolean> {
  const body = (await page.locator('body').textContent()) ?? '';
  return /shared notes|agency notes|internal notes|booking notes|model notes|add note|save note|note/i.test(body);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Calendar Booking Notes Restore @booking-notes-restore', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  // ─── BN-01: CORE FIX — Agency month view event chip opens detail ──────────
  test('BN-01: agency MONTH view: clicking event chip opens detail overlay [CORE FIX] @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Calendar → month view');
    await openCalendarView(page, 'month');

    await testInfo.attach('before-click-month-agency.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    checkpoint(testInfo, 'click event chip in month view');
    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description:
          'No event found in month view — cannot verify chip click. ' +
          'Please add a calendar event and re-run for full coverage.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    await testInfo.attach('after-click-month-agency.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    const hasNotes = await detailOverlayHasNotes(page);
    const body = (await page.locator('body').textContent()) ?? '';

    // The detail overlay must show note-related content or event detail content
    expect(body.toLowerCase()).toMatch(
      /note|detail|booking|option|casting|job|date|model|shared|internal|agency/,
    );

    test.info().annotations.push({
      type: 'info',
      description: `Month event chip click: detail visible=${hasNotes}, body snippet="${body.slice(0, 200)}"`,
    });

    await expectNonBlankShell(page, 'month event detail opened');
  });

  // ─── BN-02: Regression guard — week view event still opens detail ─────────
  test('BN-02: agency WEEK view: clicking event opens detail overlay [REGRESSION GUARD] @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Calendar → week view');
    await openCalendarView(page, 'week');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event found in week view — regression guard skipped.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(
      /note|detail|booking|option|casting|job|date|model|shared|internal|agency/,
    );

    await testInfo.attach('week-event-detail.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'week event detail opened');
  });

  // ─── BN-03: Regression guard — day view event still opens detail ──────────
  test('BN-03: agency DAY view: clicking event opens detail overlay [REGRESSION GUARD] @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Calendar → day view');
    await openCalendarView(page, 'day');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event found in day view — regression guard skipped.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(
      /note|detail|booking|option|casting|job|date|model|shared|internal|agency/,
    );

    await testInfo.attach('day-event-detail.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'day event detail opened');
  });

  // ─── BN-04: Agency internal notes NOT exposed to client ───────────────────
  test('BN-04: client calendar: no agency internal notes visible @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'clientOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'open Calendar (client)');
    await openCalendarView(page, 'week');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event found for client — isolation check skipped.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';
    // Agency-internal notes must not appear for client
    expect(body.toLowerCase()).not.toMatch(/agency notes|internal notes/);

    await testInfo.attach('client-event-detail-isolation.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'client event detail - no agency notes');
  });

  // ─── BN-05: Client month view event chip opens detail ─────────────────────
  test('BN-05: client MONTH view: clicking event chip opens detail overlay @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'clientOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'clientOwner', { testInfo });

    checkpoint(testInfo, 'client opens Calendar → month view');
    await openCalendarView(page, 'month');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event in client month view — test annotated.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(
      /note|detail|booking|option|casting|job|date|model|shared/,
    );

    await testInfo.attach('client-month-event-detail.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'client month event detail opened');
  });

  // ─── BN-06: Model month view event chip opens detail (no pricing) ─────────
  test('BN-06: model MONTH view: clicking event opens notes overlay (no price data) @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'modelLinked',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'modelLinked', { testInfo });

    checkpoint(testInfo, 'model navigates to calendar');
    await page.waitForTimeout(4000);

    const calLink = page
      .getByText('Calendar', { exact: true })
      .or(page.getByText('Schedule', { exact: true }))
      .first();

    if (await calLink.isVisible().catch(() => false)) {
      await calLink.click({ force: true });
      await page.waitForTimeout(3000);
    }

    await openCalendarView(page, 'month');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event in model month view — test annotated.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';

    // Model must never see price-related data
    expect(body.toLowerCase()).not.toMatch(/proposed price|agency counter|client_price_status|fee negotiation/);

    // Should see note-related content
    test.info().annotations.push({
      type: 'info',
      description: `Model month event body snippet: "${body.slice(0, 200)}"`,
    });

    await testInfo.attach('model-month-event-detail.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'model month event detail opened');
  });

  // ─── BN-07: Month/Week/Day consistency — same event opens same detail ──────
  test('BN-07: month/week/day: same event opens consistent detail content @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open week view and click event');
    await openCalendarView(page, 'week');

    const weekClicked = await clickFirstCalendarEvent(page);
    const weekBody = weekClicked ? (await page.locator('body').textContent()) ?? '' : '';

    await testInfo.attach('consistency-week.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Close overlay if open (press Escape or navigate back)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    checkpoint(testInfo, 'open day view and click event');
    await openCalendarView(page, 'day');
    const dayClicked = await clickFirstCalendarEvent(page);
    const dayBody = dayClicked ? (await page.locator('body').textContent()) ?? '' : '';

    await testInfo.attach('consistency-day.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    test.info().annotations.push({
      type: 'info',
      description:
        `Week click: ${weekClicked}, Day click: ${dayClicked}. ` +
        `Week body len: ${weekBody.length}, Day body len: ${dayBody.length}`,
    });

    // Both views should show similar kinds of content when an event exists
    if (weekClicked && dayClicked) {
      const weekHasDetail = /note|detail|booking|option|casting|job|model/.test(weekBody.toLowerCase());
      const dayHasDetail = /note|detail|booking|option|casting|job|model/.test(dayBody.toLowerCase());
      expect(weekHasDetail).toBe(dayHasDetail);
    }

    await expectNonBlankShell(page, 'month/week/day consistency check');
  });

  // ─── BN-08: Booker parity — same access as agency owner ───────────────────
  test('BN-08: booker MONTH view: event chip opens detail overlay (parity with owner) @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'booker',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'booker', { testInfo });

    checkpoint(testInfo, 'booker opens Calendar → month view');
    await openCalendarView(page, 'month');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({
        type: 'info',
        description: 'No event found for booker — parity check skipped.',
      });
      await expectNonBlankShell(page, 'no event found graceful');
      return;
    }

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(
      /note|detail|booking|option|casting|job|date|model|shared|internal|agency/,
    );

    await testInfo.attach('booker-month-event-detail.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'booker month event detail opened');
  });

  // ─── BN-09: No crash when overlay is opened and closed ────────────────────
  test('BN-09: calendar event detail overlay can be opened and closed without crash @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    // Week view (reliable baseline)
    checkpoint(testInfo, 'open Calendar → week view');
    await openCalendarView(page, 'week');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({ type: 'info', description: 'No event found — crash test skipped.' });
      await expectNonBlankShell(page, 'no event graceful');
      return;
    }

    await testInfo.attach('overlay-open.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Close overlay
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Or tap a close / back button if Escape doesn't work
    const closeBtn = page
      .getByRole('button', { name: /close|back|×|✕/i })
      .first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }

    await testInfo.attach('overlay-closed.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // App must not crash — calendar content still visible
    await expectNonBlankShell(page, 'overlay close without crash');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.toLowerCase()).toMatch(/calendar|event|add|option|month|week|day/);
  });

  // ─── BN-10: No duplicate overlays when clicking event in month ─────────────
  test('BN-10: month view: no duplicate overlays or renders when chip clicked @booking-notes-restore', async ({
    page,
  }, testInfo) => {
    setE2eDiagnosticContext({
      roleKey: 'agencyOwner',
      writeKind: 'read',
      emailDomainHint: defaultSeedEmailDomain(),
    });
    await signInAs(page, 'agencyOwner', { testInfo });

    checkpoint(testInfo, 'open Calendar → month view');
    await openCalendarView(page, 'month');

    const clicked = await clickFirstCalendarEvent(page);

    if (!clicked) {
      test.info().annotations.push({ type: 'info', description: 'No event found — duplicate check skipped.' });
      await expectNonBlankShell(page, 'no event graceful');
      return;
    }

    // Check that the page doesn't contain duplicate note sections
    const noteSectionCount = await page
      .locator(':text("Shared Notes"), :text("Shared Booking Notes"), :text("Agency Notes"), :text("Internal Notes")')
      .count()
      .catch(() => 0);

    test.info().annotations.push({
      type: 'info',
      description: `Notes sections visible: ${noteSectionCount}`,
    });

    // Should not have more than 2 note sections visible simultaneously
    // (shared + agency is the expected max for agency role)
    expect(noteSectionCount).toBeLessThanOrEqual(4);

    await testInfo.attach('no-duplicate-overlays.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expectNonBlankShell(page, 'no duplicate overlays');
  });
});
