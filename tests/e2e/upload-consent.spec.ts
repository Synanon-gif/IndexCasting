/**
 * Upload / image-rights UI — safety classification:
 * - Unauthenticated probe: read-only (body text heuristic).
 * - Authenticated "Add model" + chat file checkbox: opens modals / navigates only; **no** submit, **no** file upload,
 *   **no** extra write gates (see docs/e2e-test-matrix.md). If a future change adds Save/Upload/Create, gate it like chat/lifecycle.
 */
import { test, expect } from './fixtures/base';
import { signInAs } from './helpers/auth';
import { credentialGapMessage, emailForRole, hasAuthCredentials } from './helpers/env';

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL?.trim() || emailForRole('agencyOwner');
const AUTHENTICATED = hasAuthCredentials() && !!TEST_EMAIL;

test.describe('Upload protection — unauthenticated', () => {
  test('root does not expose upload-rights UI to anonymous users', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const bodyText = (await page.locator('body').textContent()) ?? '';

    const exposesUploadUi =
      bodyText.toLowerCase().includes('choose file') ||
      bodyText.toLowerCase().includes('upload photo') ||
      bodyText.toLowerCase().includes('select image') ||
      bodyText.toLowerCase().includes('i confirm i have all');

    expect(exposesUploadUi).toBe(false);
  });
});

test.describe('Image rights checkbox — authenticated', () => {
  test.skip(!AUTHENTICATED, credentialGapMessage());

  test.beforeEach(async ({ page }, testInfo) => {
    // Use the canonical resilient signInAs helper (handles Login / Sign in / Log in / geometry fallback).
    // P2-2026-05-11-001 fix: replaced brittle /^Login$/i raw selector with signInAs().
    await signInAs(page, 'agencyOwner', { testInfo });
  });

  test('My Models path shows rights-related UI when adding a model (best-effort)', async ({
    page,
  }) => {
    const modelsTab = page.getByText('My Models', { exact: true }).first();
    if (await modelsTab.isVisible().catch(() => false)) {
      await modelsTab.click();
    } else {
      await page.getByText(/models/i).first().click();
    }
    await page.waitForTimeout(2000);

    const addBtn = page.getByRole('button', { name: /add model|new model/i }).first();
    if (!(await addBtn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await addBtn.click();
    await page.waitForTimeout(1000);

    const rightsCheckbox = page
      .locator('[data-testid="image-rights-checkbox"]')
      .or(page.getByRole('checkbox', { name: /rights|consents/i }))
      .or(page.getByText(/i confirm i have all/i));

    await expect(rightsCheckbox.first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Chat file upload consent', () => {
  test.skip(!AUTHENTICATED, credentialGapMessage());

  test('booking chat file rights checkbox (best-effort; skips if no chat)', async ({ page }, testInfo) => {
    // Use the canonical resilient signInAs helper.
    // P2-2026-05-11-002 fix: replaced brittle /^Login$/i raw selector with signInAs().
    await signInAs(page, 'agencyOwner', { testInfo });

    const chatArea = page.getByTestId('booking-chat').or(page.getByText(/booking chat/i).first());
    if (!(await chatArea.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const rightsCheckbox = page
      .locator('[data-testid="file-rights-checkbox"]')
      .or(page.getByRole('checkbox', { name: /rights|consents/i }));

    await expect(rightsCheckbox.first()).toBeVisible({ timeout: 3000 });
  });
});
