import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/base';
import { calendarStepNavigationIfPresent, cycleB2BCalendarViewModes } from './helpers/appAssertions';
import { clickAndCheckpoint, checkpoint } from './helpers/checkpoints';
import { signInAs } from './helpers/auth';
import { credentialGapMessage, hasAuthCredentials } from './helpers/env';

const needsCreds = hasAuthCredentials();

async function calendarWorkflow(page: Page, role: 'agency' | 'client' | 'model', testInfo: TestInfo) {
  checkpoint(testInfo, `calendar: signIn ${role}`);
  if (role === 'agency') await signInAs(page, 'agencyOwner', { testInfo });
  else if (role === 'client') await signInAs(page, 'clientOwner', { testInfo });
  else await signInAs(page, 'modelLinked', { testInfo });

  const cal = page.getByText(/^Calendar$/).first();
  await clickAndCheckpoint(cal, 'Calendar tab', testInfo);
  await page.waitForTimeout(2000);

  await cycleB2BCalendarViewModes(page);
  await calendarStepNavigationIfPresent(page);

  const body = (await page.locator('body').textContent()) ?? '';
  expect(body.length).toBeGreaterThan(80);

  const eventish = page.getByText(/E2E TEST|showroom|fitting|PLAYWRIGHT|Option|Casting|job|Job/i).first();
  if (await eventish.isVisible().catch(() => false)) {
    await clickAndCheckpoint(eventish, 'calendar seeded/event label', testInfo);
    await page.waitForTimeout(1500);
    const detail = (await page.locator('body').textContent()) ?? '';
    expect(detail.length).toBeGreaterThan(80);
    expect(detail.toLowerCase()).toMatch(
      /e2e|playwright|option|casting|job|showroom|fitting|model|date|status|note|book|tentative|horizon/i,
    );

    const back = page.getByRole('button', { name: /^Back$/i }).first();
    if (await back.isVisible().catch(() => false)) {
      await clickAndCheckpoint(back, 'close calendar detail (Back)', testInfo);
    } else {
      await page.keyboard.press('Escape');
      checkpoint(testInfo, 'close calendar detail (Escape)');
    }
    await page.waitForTimeout(800);
  } else {
    testInfo.annotations.push({
      type: 'e2e-warning',
      description:
        'No seeded calendar label matched — BLOCKER (selector-gap or empty calendar): see failure-summary if test failed later.',
    });
  }

  await cycleB2BCalendarViewModes(page);
}

test.describe('P0.12 Calendar — navigation & views', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('agency: Month/Week/Day, nav, optional event tap & close @p0', async ({ page }, testInfo) => {
    await calendarWorkflow(page, 'agency', testInfo);
  });

  test('client: Month/Week/Day, nav, optional event tap & close @p0', async ({ page }, testInfo) => {
    await calendarWorkflow(page, 'client', testInfo);
  });

  test('model: calendar views and seeded markers @p0', async ({ page }, testInfo) => {
    await calendarWorkflow(page, 'model', testInfo);
  });
});

test.describe('P0.12 Calendar — duplicate lifecycle heuristic', () => {
  test.beforeEach(() => {
    test.skip(!needsCreds, credentialGapMessage());
  });

  test('no obvious duplicate of same seeded title on screen @p0', async ({ page }, testInfo) => {
    checkpoint(testInfo, 'duplicate heuristic start');
    await signInAs(page, 'agencyOwner', { testInfo });
    await page.getByText(/^Calendar$/).first().click();
    await page.waitForTimeout(3500);
    const body = (await page.locator('body').textContent()) ?? '';
    const marker = 'E2E TEST — showroom block';
    const n = body.split(marker).length - 1;
    expect(n).toBeLessThan(3);
  });
});
