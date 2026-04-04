# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-pages.spec.ts >> Legal link navigation from landing page >> clicking Privacy Policy link navigates to /privacy
- Location: e2e/public-pages.spec.ts:80:7

# Error details

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('footer a[href="/privacy"]')

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]: INDEX CASTING
  - generic [ref=e7]: B2B platform for fashion casting
  - generic [ref=e8]:
    - generic [ref=e10] [cursor=pointer]: Login
    - generic [ref=e12] [cursor=pointer]: Sign Up
  - textbox "Email" [ref=e13]
  - textbox "Password" [ref=e14]
  - textbox "Display name" [ref=e15]
  - generic [ref=e16]: Role
  - generic [ref=e17]:
    - generic [ref=e19] [cursor=pointer]: Client
    - generic [ref=e21] [cursor=pointer]: Agency
    - generic [ref=e23] [cursor=pointer]: Model
  - generic [ref=e24]: The first signup as Client or Agency (without an invitation link) creates your organization and assigns you as the Organization Owner. People who register using an invite link you send become employees or bookers — they are not owners.
  - textbox "Company or organization name" [ref=e25]
  - generic [ref=e27] [cursor=pointer]: Create Account
  - generic [ref=e28]:
    - generic [ref=e30] [cursor=pointer]: Terms of Service
    - generic [ref=e31]: ·
    - generic [ref=e33] [cursor=pointer]: Privacy Policy
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | /**
  4  |  * Public Pages E2E Tests
  5  |  *
  6  |  * Verifies that all public-facing entry points are reachable and contain
  7  |  * the expected legal links — a hard requirement for GDPR + legal compliance.
  8  |  */
  9  | 
  10 | test.describe('Landing page', () => {
  11 |   test('loads and displays the IndexCasting brand', async ({ page }) => {
  12 |     await page.goto('/');
  13 |     await expect(page).toHaveTitle(/index casting/i);
  14 |     // Main headline
  15 |     await expect(page.locator('h1')).toContainText(/index casting/i);
  16 |   });
  17 | 
  18 |   test('footer contains a Terms of Service link pointing to /terms', async ({ page }) => {
  19 |     await page.goto('/');
  20 |     const termsLink = page.locator('footer a[href="/terms"]');
  21 |     await expect(termsLink).toBeVisible();
  22 |     await expect(termsLink).toContainText(/terms/i);
  23 |   });
  24 | 
  25 |   test('footer contains a Privacy Policy link pointing to /privacy', async ({ page }) => {
  26 |     await page.goto('/');
  27 |     const privacyLink = page.locator('footer a[href="/privacy"]');
  28 |     await expect(privacyLink).toBeVisible();
  29 |     await expect(privacyLink).toContainText(/privacy/i);
  30 |   });
  31 | });
  32 | 
  33 | test.describe('/terms page', () => {
  34 |   test('loads without a 404 error', async ({ page }) => {
  35 |     const response = await page.goto('/terms');
  36 |     // Any 2xx or redirect is acceptable; only hard 4xx/5xx is a failure
  37 |     expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  38 |   });
  39 | 
  40 |   test('contains legal / terms content', async ({ page }) => {
  41 |     await page.goto('/terms');
  42 |     // Page should reference "Terms" somewhere in visible text
  43 |     const body = page.locator('body');
  44 |     await expect(body).toContainText(/terms/i);
  45 |   });
  46 | 
  47 |   test('provides a way back to the main app (back-navigation or link)', async ({ page }) => {
  48 |     await page.goto('/terms');
  49 |     // Either a "back" button or navigating to '/' should work
  50 |     await page.goto('/');
  51 |     await expect(page.locator('h1')).toBeVisible();
  52 |   });
  53 | });
  54 | 
  55 | test.describe('/privacy page', () => {
  56 |   test('loads without a 404 error', async ({ page }) => {
  57 |     const response = await page.goto('/privacy');
  58 |     expect(response?.status()).not.toBeGreaterThanOrEqual(400);
  59 |   });
  60 | 
  61 |   test('contains privacy / data-protection content', async ({ page }) => {
  62 |     await page.goto('/privacy');
  63 |     const body = page.locator('body');
  64 |     await expect(body).toContainText(/privacy/i);
  65 |   });
  66 | });
  67 | 
  68 | test.describe('Legal link navigation from landing page', () => {
  69 |   test('clicking Terms of Service link navigates to /terms', async ({ page }) => {
  70 |     await page.goto('/');
  71 |     await page.locator('footer a[href="/terms"]').click();
  72 |     // After click: either URL changes or content updates (SPA navigation)
  73 |     await page.waitForTimeout(1000);
  74 |     const currentUrl = page.url();
  75 |     const bodyText   = await page.locator('body').textContent();
  76 |     const navigated  = currentUrl.includes('/terms') || (bodyText ?? '').toLowerCase().includes('terms');
  77 |     expect(navigated).toBe(true);
  78 |   });
  79 | 
  80 |   test('clicking Privacy Policy link navigates to /privacy', async ({ page }) => {
  81 |     await page.goto('/');
> 82 |     await page.locator('footer a[href="/privacy"]').click();
     |                                                     ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  83 |     await page.waitForTimeout(1000);
  84 |     const currentUrl = page.url();
  85 |     const bodyText   = await page.locator('body').textContent();
  86 |     const navigated  = currentUrl.includes('/privacy') || (bodyText ?? '').toLowerCase().includes('privacy');
  87 |     expect(navigated).toBe(true);
  88 |   });
  89 | });
  90 | 
```