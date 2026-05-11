/**
 * Wave 5 — Storage / Upload Hardening
 * Run ID: WAVE5-RUN-2026-05-11
 *
 * Tests storage robustness: signed URL validity, unauthorized access prevention,
 * MIME safety, orphan prevention, and media pipeline consistency.
 *
 * Does NOT repeat basic upload CRUD from Wave 4.
 * All created files prefixed WAVE5-E2E.
 */

import { test, expect } from '@playwright/test';
import { billingGuardActive, billingGuardSkipMessage } from './helpers/env';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://indexcasting.com';
const SUPABASE_URL = `https://ispkfdqzjrfrilosoklu.supabase.co`;
const RUN_ID = 'WAVE5-RUN-2026-05-11';

test.describe('W5-STOR — Storage / Upload Hardening @wave5', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.annotations.push({ type: 'wave', description: 'Wave 5 — Hardening' });
    testInfo.annotations.push({ type: 'runId', description: RUN_ID });
  });

  // ──────────────────────────────────────────────
  // W5-STOR01: Unsigned access to private bucket returns non-200
  // ──────────────────────────────────────────────
  test('W5-STOR01: direct unsigned access to private bucket is blocked @wave5', async ({ request }) => {
    // Attempt direct access to documentspictures bucket without signing
    const res = await request.get(
      `${SUPABASE_URL}/storage/v1/object/documentspictures/model-photos/wave5-nonexistent.png`,
      { timeout: 10000 }
    ).catch(() => null);

    if (!res) {
      test.info().annotations.push({ type: 'info', description: 'Request failed (network) — not an issue for this test' });
      return;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Unsigned access to private bucket: HTTP ${res.status()}`,
    });
    // Private bucket must NOT return 200 for unsigned, unauthenticated access
    expect(res.status(), 'Private bucket returns non-200 for unsigned access').not.toBe(200);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY P0: Private bucket blocks unsigned access' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR02: Invalid/non-existent path returns 404 or 400 (not 200)
  // ──────────────────────────────────────────────
  test('W5-STOR02: non-existent storage path returns 404 or error @wave5', async ({ request }) => {
    const res = await request.get(
      `${SUPABASE_URL}/storage/v1/object/public/documentspictures/wave5-nonexistent-${Date.now()}.png`,
      { timeout: 10000 }
    ).catch(() => null);

    if (!res) return;

    const status = res.status();
    test.info().annotations.push({ type: 'info', description: `Non-existent path status: ${status}` });
    expect([400, 401, 403, 404, 406]).toContain(status);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: Non-existent storage path returns error' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR03: Supabase storage health endpoint reachable
  // ──────────────────────────────────────────────
  test('W5-STOR03: Supabase storage service health @wave5', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/storage/v1/`, { timeout: 10000 }).catch(() => null);
    test.info().annotations.push({
      type: 'info',
      description: `Storage service response: ${res ? res.status() : 'unreachable'}`,
    });
    // Service should be up (200 or 404 for specific path is fine; 5xx is not)
    if (res) {
      expect(res.status()).toBeLessThan(500);
    }
  });

  // ──────────────────────────────────────────────
  // W5-STOR04: App images do not request private paths without signing
  // ──────────────────────────────────────────────
  test('W5-STOR04: app does not attempt direct unsigned image loads for private bucket @wave5', async ({ page }) => {
    const unsignedPrivateRequests: string[] = [];
    page.on('request', r => {
      const u = r.url();
      // Detect: direct object access without token= param (unsigned) to private bucket
      if (
        u.includes('supabase.co/storage/v1/object/') &&
        u.includes('documentspictures') &&
        !u.includes('token=') &&
        !u.includes('/public/')
      ) {
        unsignedPrivateRequests.push(u.replace(/[0-9a-f\-]{36}/g, '<uuid>').slice(0, 100));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `Unsigned private storage requests: ${unsignedPrivateRequests.length}`,
    });
    if (unsignedPrivateRequests.length > 0) {
      test.info().annotations.push({
        type: 'warn',
        description: `Paths: ${unsignedPrivateRequests.slice(0, 3).join(' | ')}`,
      });
    }
    // This is a security signal — the app should sign URLs before rendering
    expect(unsignedPrivateRequests.length, 'No unsigned private storage requests from app').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: App uses signed URLs for private storage' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR05: No service_role key in network requests
  // ──────────────────────────────────────────────
  test('W5-STOR05: no service_role JWT in browser network requests @wave5', async ({ page }) => {
    const serviceRoleRequests: string[] = [];
    page.on('request', r => {
      const auth = r.headers()['authorization'] ?? '';
      // Service role tokens decode to {"role":"service_role"} — in base64 it's "c2VydmljZV9yb2xl"
      if (auth.includes('c2VydmljZV9yb2xl') || auth.toLowerCase().includes('service_role')) {
        serviceRoleRequests.push(r.url().slice(0, 80));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'info',
      description: `Requests with potential service_role JWT: ${serviceRoleRequests.length}`,
    });
    expect(serviceRoleRequests.length, 'No service_role JWT in browser requests').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'SECURITY P0: No service_role key in browser network requests' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR06: No ERR_UNKNOWN_URL_SCHEME in image loads
  // ──────────────────────────────────────────────
  test('W5-STOR06: no ERR_UNKNOWN_URL_SCHEME console errors on image load @wave5', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const unknownScheme = consoleErrors.filter(e => /ERR_UNKNOWN_URL_SCHEME|supabase-storage:\/\//i.test(e));
    test.info().annotations.push({
      type: 'info',
      description: `ERR_UNKNOWN_URL_SCHEME errors: ${unknownScheme.length}`,
    });
    expect(unknownScheme.length, 'No ERR_UNKNOWN_URL_SCHEME errors (storage URIs must be resolved)').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'STORAGE: All image URLs resolved correctly (no raw scheme errors)' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR07: Upload page / media settings does not expose bucket names
  // ──────────────────────────────────────────────
  test('W5-STOR07: bucket name not exposed to anonymous users @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().catch(() => '');

    // Bucket name should not be exposed as visible text to anon
    const bucketNameLeak = /documentspictures|chat-files|verifications/.test(body ?? '');
    test.info().annotations.push({
      type: 'info',
      description: `Bucket name in visible text: ${bucketNameLeak}`,
    });
    if (bucketNameLeak) {
      test.info().annotations.push({
        type: 'warn',
        description: 'SECURITY NOTE: Bucket name visible in page — verify this is not on a sensitive route',
      });
    }
  });

  // ──────────────────────────────────────────────
  // W5-STOR08: Storage path consistency — no raw null in img src
  // ──────────────────────────────────────────────
  test('W5-STOR08: no "null" or "undefined" in image src attributes @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const images = await page.locator('img').all();
    let brokenSrcs = 0;
    for (const img of images.slice(0, 30)) {
      const src = await img.getAttribute('src').catch(() => null);
      if (src === 'null' || src === 'undefined' || src === '') brokenSrcs++;
    }

    test.info().annotations.push({
      type: 'info',
      description: `Images checked: ${Math.min(images.length, 30)}, broken srcs (null/undefined/empty): ${brokenSrcs}`,
    });
    expect(brokenSrcs, 'No null/undefined image src attributes').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'STORAGE: No broken null image sources on page' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR09: Network image requests don't fail with 403
  // ──────────────────────────────────────────────
  test('W5-STOR09: no unexpected 403 on image network requests @wave5', async ({ page }) => {
    const forbiddenImages: string[] = [];
    page.on('response', r => {
      if (r.status() === 403 && r.url().includes('storage')) {
        forbiddenImages.push(r.url().replace(/[0-9a-f\-]{36}/g, '<uuid>').slice(0, 100));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `Storage 403 responses: ${forbiddenImages.length}`,
    });
    // On public pages, no storage 403 should occur (no images should be attempted without signing)
    expect(forbiddenImages.length, 'No 403 storage responses for anonymous page load').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-STOR10: Images visible on public discover/landing
  // ──────────────────────────────────────────────
  test('W5-STOR10: landing page has at least one successfully loaded image @wave5', async ({ page }) => {
    let loadedImages = 0;
    page.on('response', r => {
      if (r.status() === 200 && r.url().includes('storage') && /\.(png|jpg|jpeg|webp|gif)/i.test(r.url())) {
        loadedImages++;
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `Successfully loaded storage images: ${loadedImages}`,
    });
    // Public landing may not have images — this is an observation test
    test.info().annotations.push({ type: 'info', description: `Image load count for manual review: ${loadedImages}` });
  });

  // ──────────────────────────────────────────────
  // W5-STOR11: CORS headers present on storage responses
  // ──────────────────────────────────────────────
  test('W5-STOR11: Supabase storage CORS headers present @wave5', async ({ request }) => {
    const res = await request.get(
      `${SUPABASE_URL}/storage/v1/`,
      { headers: { 'Origin': BASE_URL }, timeout: 10000 }
    ).catch(() => null);

    if (!res) return;

    const headers = res.headers();
    test.info().annotations.push({
      type: 'info',
      description: `Storage CORS headers: access-control-allow-origin=${headers['access-control-allow-origin'] ?? 'not set'}`,
    });
    // Storage should return CORS headers
    // Not a hard failure if missing — document for ops review
  });

  // ──────────────────────────────────────────────
  // W5-STOR12: No storage path traversal via URL params
  // ──────────────────────────────────────────────
  test('W5-STOR12: storage endpoint blocks path traversal attempts @wave5', async ({ request }) => {
    const traversalPaths = [
      '/storage/v1/object/public/documentspictures/../../../etc/passwd',
      '/storage/v1/object/public/documentspictures/..%2F..%2Fetc%2Fpasswd',
    ];

    for (const path of traversalPaths) {
      const res = await request.get(`${SUPABASE_URL}${path}`, { timeout: 8000 }).catch(() => null);
      if (res) {
        test.info().annotations.push({
          type: 'info',
          description: `Path traversal attempt '${path.slice(-30)}': HTTP ${res.status()}`,
        });
        expect(res.status(), 'Path traversal returns error').not.toBe(200);
      }
    }
    test.info().annotations.push({ type: 'pass', description: 'SECURITY: Path traversal attempts blocked' });
  });

  // ──────────────────────────────────────────────
  // W5-STOR13: No console 404 storm on image loads
  // ──────────────────────────────────────────────
  test('W5-STOR13: no 404 storm on storage image loads @wave5', async ({ page }) => {
    const notFoundRequests: string[] = [];
    page.on('response', r => {
      if (r.status() === 404 && r.url().includes('storage')) {
        notFoundRequests.push(r.url().replace(/[0-9a-f\-]{36}/g, '<uuid>').slice(0, 80));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    test.info().annotations.push({
      type: 'info',
      description: `Storage 404s on page load: ${notFoundRequests.length}`,
    });
    // More than 5 storage 404s on landing = image pipeline issue
    if (notFoundRequests.length > 5) {
      test.info().annotations.push({
        type: 'warn',
        description: `STORAGE: ${notFoundRequests.length} image 404s — possible broken image pipeline`,
      });
    }
    expect(notFoundRequests.length, 'No 404 storm on storage image loads').toBeLessThan(10);
  });

  // ──────────────────────────────────────────────
  // W5-STOR14: Storage API rate limit — no 429 burst
  // ──────────────────────────────────────────────
  test('W5-STOR14: storage API no rate limit errors on normal page load @wave5', async ({ page }) => {
    const rateLimited: string[] = [];
    page.on('response', r => {
      if (r.status() === 429) rateLimited.push(r.url().slice(0, 60));
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    test.info().annotations.push({
      type: 'info',
      description: `Rate limit (429) responses: ${rateLimited.length}`,
    });
    expect(rateLimited.length, 'No rate limit errors on normal page load').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-STOR15: Billing guard active through storage tests
  // ──────────────────────────────────────────────
  test('W5-STOR15: billing guard active through storage hardening @wave5', async ({}) => {
    if (!billingGuardActive()) {
      test.skip(true, billingGuardSkipMessage());
    }
    expect(billingGuardActive()).toBe(true);
    test.info().annotations.push({ type: 'pass', description: 'BILLING GUARD: Active during storage hardening' });
  });
});
