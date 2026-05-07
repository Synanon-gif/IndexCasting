import type { Page } from '@playwright/test';
import { expect } from '../fixtures/base';

/** Fails if body is empty / shell likely failed — use after tab navigation. */
export async function expectNonBlankShell(page: Page, hint: string): Promise<void> {
  const body = (await page.locator('body').textContent())?.trim() ?? '';
  expect(body.length, `Blank or minimal shell (${hint})`).toBeGreaterThan(120);
}

/** Calendar Month/Week/Day pills use accessibilityRole=button and label `"${label} view"` (CalendarViewModeBar). */
export async function cycleB2BCalendarViewModes(page: Page): Promise<void> {
  for (const label of ['Month', 'Week', 'Day']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label} view$`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(800);
    }
  }
}

/** Optional: previous / next period — many screens use chevron or "Previous". */
export async function calendarStepNavigationIfPresent(page: Page): Promise<void> {
  const prev = page
    .getByRole('button', { name: /previous|prev|^◀|^<|chevron back/i })
    .first();
  const next = page.getByRole('button', { name: /next|^▶|^>|chevron forward/i }).first();
  if (await prev.isVisible().catch(() => false)) {
    await prev.click();
    await page.waitForTimeout(600);
  }
  if (await next.isVisible().catch(() => false)) {
    await next.click();
    await page.waitForTimeout(600);
  }
}
