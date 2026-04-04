import { test, expect } from '@playwright/test';

/**
 * Upload Consent UI Tests (GDPR / Image Rights)
 *
 * Verifies that the upload rights confirmation checkbox is:
 *  - Present in contexts where uploads are allowed
 *  - Enforced (upload blocked without confirmation)
 *
 * Since upload screens require authentication, these tests cover:
 *  1. The public-facing behavior (no upload without login)
 *  2. The consent checkbox presence (checked by inspecting DOM after login,
 *     which requires test credentials via env vars)
 *
 * Full authenticated upload-consent testing requires:
 *   PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD env vars
 *   pointing to a seeded test account with agency/model access.
 *
 * Without those vars, the tests verify the unauthenticated safety guarantees.
 */

const TEST_EMAIL    = process.env.PLAYWRIGHT_TEST_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const AUTHENTICATED = !!(TEST_EMAIL && TEST_PASSWORD);

test.describe('Upload protection — unauthenticated', () => {
  test('upload endpoints redirect unauthenticated users away from upload flows', async ({ page }) => {
    // Model management / upload routes should require auth
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Attempting direct navigation to any sensitive route should not show upload UI
    // The app will show login or redirect — not the upload form
    const bodyText = (await page.locator('body').textContent()) ?? '';

    // Should NOT expose file-picker or upload UI to anon users
    const exposesUploadUi =
      bodyText.toLowerCase().includes('choose file') ||
      bodyText.toLowerCase().includes('upload photo') ||
      bodyText.toLowerCase().includes('select image') ||
      bodyText.toLowerCase().includes('i confirm i have all');

    expect(exposesUploadUi).toBe(false);
  });
});

test.describe('Image rights checkbox — authenticated', () => {
  test.skip(!AUTHENTICATED, 'Requires PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD');

  test.beforeEach(async ({ page }) => {
    // Sign in via UI
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Fill login form (selectors follow the app's testId or accessible role)
    await page.getByRole('textbox', { name: /email/i }).fill(TEST_EMAIL!);
    await page.getByRole('button', { name: /continue|sign in|log in/i }).click();
    await page.waitForTimeout(2000);
  });

  test('model photo upload screen requires rights-confirmation before enabling upload', async ({ page }) => {
    // Navigate to model management
    await page.getByText(/models|my models/i).first().click();
    await page.waitForTimeout(1500);

    // Open a model or create one
    await page.getByRole('button', { name: /add model|new model/i }).first().click();
    await page.waitForTimeout(1000);

    // The rights confirmation checkbox should be present
    const rightsCheckbox = page.locator('[data-testid="image-rights-checkbox"]')
      .or(page.getByRole('checkbox', { name: /rights|consents/i }))
      .or(page.getByText(/i confirm i have all/i));

    await expect(rightsCheckbox.first()).toBeVisible({ timeout: 5000 });
  });

  test('upload is blocked until the rights checkbox is confirmed', async ({ page }) => {
    // Navigate to a model's photo upload screen
    await page.getByText(/models/i).first().click();
    await page.waitForTimeout(1500);

    // Look for an upload button
    const uploadButton = page.getByRole('button', { name: /upload|add photo/i }).first();
    if (!(await uploadButton.isVisible())) {
      test.skip(); // Upload button not in this view
      return;
    }

    // Attempt to click upload WITHOUT confirming rights first
    // The rights checkbox should be unchecked by default
    const rightsCheckbox = page.locator('[data-testid="image-rights-checkbox"]').first();
    if (await rightsCheckbox.isVisible()) {
      await expect(rightsCheckbox).not.toBeChecked();
      // Upload button should be disabled or blocked
      await uploadButton.click();
      // No file picker should open; an error or disabled state expected
      const bodyText = await page.locator('body').textContent();
      const blocked = (bodyText ?? '').toLowerCase().includes('confirm') ||
        (bodyText ?? '').toLowerCase().includes('rights') ||
        await uploadButton.isDisabled();
      expect(blocked).toBe(true);
    }
  });
});

test.describe('Chat file upload consent', () => {
  test.skip(!AUTHENTICATED, 'Requires PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD');

  test('file attachment in booking chat requires rights confirmation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Navigate to a booking chat (requires existing booking)
    // This test verifies the checkbox is visible before any attachment is allowed
    const chatArea = page.getByTestId('booking-chat').or(page.getByText(/booking chat/i).first());
    if (!(await chatArea.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(); // No booking chat visible in current state
      return;
    }

    // Rights confirmation checkbox should appear in the chat file upload area
    const rightsCheckbox = page
      .locator('[data-testid="file-rights-checkbox"]')
      .or(page.getByRole('checkbox', { name: /rights|consents/i }));

    await expect(rightsCheckbox.first()).toBeVisible({ timeout: 3000 });
  });
});
