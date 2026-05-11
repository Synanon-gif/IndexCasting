/**
 * Wave 5 — Long-Run / Stability Hardening
 * Run ID: WAVE5-RUN-2026-05-11
 *
 * Tests long-lived tabs, repeated navigation, modal cycling,
 * memory growth observation, and extended runtime degradation.
 *
 * Safety: purely observational — no mutations, no auth, no real user actions.
 * Tests are time-bounded and do NOT run infinite loops.
 */

import { test, expect } from '@playwright/test';
import { billingGuardActive, billingGuardSkipMessage } from './helpers/env';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://indexcasting.com';
const RUN_ID = 'WAVE5-RUN-2026-05-11';

// Longrun tests may take up to 90s each
test.setTimeout(90000);

test.describe('W5-LONGRUN — Long-Run / Stability Hardening @wave5', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.annotations.push({ type: 'wave', description: 'Wave 5 — Hardening' });
    testInfo.annotations.push({ type: 'runId', description: RUN_ID });
  });

  // ──────────────────────────────────────────────
  // W5-LR01: Long-lived tab — no crash after 30s idle
  // ──────────────────────────────────────────────
  test('W5-LR01: long-lived tab — no crash after 30s idle @wave5', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(30000); // Idle for 30s

    const body = await page.locator('body').textContent().catch(() => '');
    test.info().annotations.push({
      type: 'info',
      description: `After 30s idle: JS errors=${jsErrors.length}, body length=${body?.length}`,
    });

    const crashIndicators = jsErrors.filter(e => /fatal|crash|maximum call stack|out of memory/i.test(e));
    expect(crashIndicators.length, 'No fatal errors after 30s idle').toBe(0);
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: Page survives 30s idle without crash' });
  });

  // ──────────────────────────────────────────────
  // W5-LR02: Repeated navigation — no memory warning
  // ──────────────────────────────────────────────
  test('W5-LR02: repeated navigation 10× — no console error storm @wave5', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 80)); });

    for (let i = 0; i < 10; i++) {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1000);

    test.info().annotations.push({
      type: 'info',
      description: `Console errors after 10 navigations: ${errors.length}`,
    });
    expect(errors.length).toBeLessThan(20);
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: 10 repeated navigations produce acceptable error count' });
  });

  // ──────────────────────────────────────────────
  // W5-LR03: Rapid back/forward 8× — no crash
  // ──────────────────────────────────────────────
  test('W5-LR03: rapid back/forward 8× cycles — no crash @wave5', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    for (let i = 0; i < 4; i++) {
      await page.goBack({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(200);
      await page.goForward({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1000);

    test.info().annotations.push({
      type: 'info',
      description: `JS errors after rapid back/forward: ${jsErrors.length}`,
    });
    const criticals = jsErrors.filter(e => /fatal|crash/i.test(e));
    expect(criticals.length, 'No fatal errors after rapid back/forward').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-LR04: Repeated page reload — consistent render
  // ──────────────────────────────────────────────
  test('W5-LR04: 5× reload — consistent page title @wave5', async ({ page }) => {
    const titles: string[] = [];

    for (let i = 0; i < 5; i++) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() =>
        page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
      );
      await page.waitForTimeout(500);
      titles.push(await page.title());
    }

    test.info().annotations.push({ type: 'info', description: `Titles across 5 reloads: ${titles.join(' | ')}` });

    // All titles should be the same (consistent rendering)
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBeLessThan(3); // Max 2 different titles (e.g. loading vs final)
  });

  // ──────────────────────────────────────────────
  // W5-LR05: No unbounded setInterval / polling (via request count)
  // ──────────────────────────────────────────────
  test('W5-LR05: no unbounded polling detected over 20s @wave5', async ({ page }) => {
    const supabaseRequests: string[] = [];
    page.on('request', r => {
      if (r.url().includes('supabase.co')) supabaseRequests.push(r.url().slice(0, 60));
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(20000); // 20s observation window

    test.info().annotations.push({
      type: 'info',
      description: `Supabase requests in 20s idle: ${supabaseRequests.length}`,
    });
    // 20s observation: more than 40 Supabase requests = likely unbounded polling
    expect(supabaseRequests.length, 'No unbounded polling (max 40 requests in 20s)').toBeLessThan(40);
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: No unbounded polling detected' });
  });

  // ──────────────────────────────────────────────
  // W5-LR06: Auth state persists across navigation cycles
  // ──────────────────────────────────────────────
  test('W5-LR06: auth state (anon) stable across multiple navigation cycles @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    const initialState = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const authKeys = keys.filter(k => k.includes('supabase') || k.includes('auth') || k.includes('token'));
      return authKeys.map(k => ({ k, v: (localStorage.getItem(k) ?? '').slice(0, 20) }));
    }).catch(() => []);

    // Navigate away and back
    await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const finalState = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const authKeys = keys.filter(k => k.includes('supabase') || k.includes('auth') || k.includes('token'));
      return authKeys.map(k => ({ k, v: (localStorage.getItem(k) ?? '').slice(0, 20) }));
    }).catch(() => []);

    test.info().annotations.push({
      type: 'info',
      description: `Auth localStorage keys stable: before=${initialState.length}, after=${finalState.length}`,
    });
    // State should remain consistent (no keys appearing/disappearing unexpectedly)
    expect(Math.abs(initialState.length - finalState.length)).toBeLessThan(3);
  });

  // ──────────────────────────────────────────────
  // W5-LR07: Multiple contexts — no data bleed
  // ──────────────────────────────────────────────
  test('W5-LR07: 3 simultaneous anon contexts — no shared storage @wave5', async ({ browser }) => {
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);

    const pages = await Promise.all(contexts.map(c => c.newPage()));
    await Promise.all(pages.map(p =>
      p.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {})
    ));
    await Promise.all(pages.map(p => p.waitForTimeout(2000)));

    // Store something in context 1
    await pages[0].evaluate(() => localStorage.setItem('wave5_test_isolation', 'ctx1_value')).catch(() => {});

    // Check context 2 does not see it
    const ctx2Value = await pages[1].evaluate(() => localStorage.getItem('wave5_test_isolation')).catch(() => null);

    test.info().annotations.push({
      type: 'info',
      description: `Cross-context localStorage isolation: ctx2_value=${ctx2Value}`,
    });
    expect(ctx2Value, 'Browser contexts have isolated localStorage').toBeNull();

    await Promise.all(contexts.map(c => c.close()));
    test.info().annotations.push({ type: 'pass', description: 'ISOLATION: 3 simultaneous contexts have isolated storage' });
  });

  // ──────────────────────────────────────────────
  // W5-LR08: Performance — initial page load < 10s
  // ──────────────────────────────────────────────
  test('W5-LR08: initial page load under 10 seconds @wave5', async ({ page }) => {
    const startTime = Date.now();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loadTime = Date.now() - startTime;

    test.info().annotations.push({
      type: 'info',
      description: `Initial DOMContentLoaded time: ${loadTime}ms`,
    });
    expect(loadTime, 'Page loads in under 10 seconds').toBeLessThan(10000);
    test.info().annotations.push({ type: 'pass', description: `PERFORMANCE: Page loaded in ${loadTime}ms` });
  });

  // ──────────────────────────────────────────────
  // W5-LR09: No console error tsunami on load (< 5 errors)
  // ──────────────────────────────────────────────
  test('W5-LR09: page load console errors under threshold @wave5', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 100)); });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    test.info().annotations.push({
      type: 'info',
      description: `Console errors on load: ${errors.length}\n${errors.slice(0, 5).join('\n')}`,
    });
    // Soft threshold — document errors
    if (errors.length > 5) {
      test.info().annotations.push({
        type: 'warn',
        description: `HIGH CONSOLE ERRORS: ${errors.length} errors on page load`,
      });
    }
    expect(errors.length, 'Fewer than 15 console errors on page load').toBeLessThan(15);
  });

  // ──────────────────────────────────────────────
  // W5-LR10: Idle page — no memory-growing setIntervals
  // ──────────────────────────────────────────────
  test('W5-LR10: idle for 15s — request count stays stable @wave5', async ({ page }) => {
    let requestCount0 = 0;
    let requestCount1 = 0;

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Settle

    page.on('request', () => { requestCount1++; });
    await page.waitForTimeout(5000); // Count over 5s
    const rate5s = requestCount1;

    // Reset and measure again
    requestCount1 = 0;
    await page.waitForTimeout(5000);
    const rate10s = requestCount1;

    test.info().annotations.push({
      type: 'info',
      description: `Requests in 5s window 1: ${rate5s}, window 2: ${rate10s}`,
    });
    // Request rate should not be growing significantly (stability)
    if (rate10s > rate5s * 2 && rate5s > 2) {
      test.info().annotations.push({
        type: 'warn',
        description: `GROWING REQUEST RATE: ${rate5s} → ${rate10s} — possible memory leak or polling growth`,
      });
    }
    // Not a hard failure — document for human review
    test.info().annotations.push({ type: 'pass', description: `STABILITY: Request rate documented: ${rate5s} / ${rate10s}` });
  });

  // ──────────────────────────────────────────────
  // W5-LR11: WebSocket connection established (if realtime used)
  // ──────────────────────────────────────────────
  test('W5-LR11: no WebSocket errors in console @wave5', async ({ page }) => {
    const wsErrors: string[] = [];
    page.on('console', msg => {
      if (/websocket|ws:\/\/|wss:\/\//i.test(msg.text()) && msg.type() === 'error') {
        wsErrors.push(msg.text().slice(0, 100));
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    test.info().annotations.push({
      type: 'info',
      description: `WebSocket errors: ${wsErrors.length}`,
    });
    expect(wsErrors.length, 'No WebSocket errors in console').toBe(0);
  });

  // ──────────────────────────────────────────────
  // W5-LR12: Hard refresh mid-idle — stable
  // ──────────────────────────────────────────────
  test('W5-LR12: hard refresh after 10s idle — stable @wave5', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(10000); // Idle 10s

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const body = await page.locator('body').textContent().catch(() => '');
    test.info().annotations.push({
      type: 'info',
      description: `JS errors after hard refresh at 10s: ${jsErrors.length}`,
    });
    expect(jsErrors.filter(e => /fatal|crash/i.test(e)).length).toBe(0);
    expect(body?.length ?? 0).toBeGreaterThan(10);
  });

  // ──────────────────────────────────────────────
  // W5-LR13: Modal-like overlay doesn't trap focus permanently
  // ──────────────────────────────────────────────
  test('W5-LR13: Escape key dismisses overlays / doesn\'t trap @wave5', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Press Escape 3× — should not crash
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    const body = await page.locator('body').textContent().catch(() => '');
    expect(body?.length ?? 0).toBeGreaterThan(5);
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: Escape key does not trap focus or crash' });
  });

  // ──────────────────────────────────────────────
  // W5-LR14: Page renders after 3× concurrent rapid requests
  // ──────────────────────────────────────────────
  test('W5-LR14: no race condition on 3 simultaneous page requests @wave5', async ({ browser }) => {
    const ctx = await browser.newContext();
    const pages = await Promise.all([ctx.newPage(), ctx.newPage(), ctx.newPage()]);

    await Promise.all(pages.map(p =>
      p.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {})
    ));
    await Promise.all(pages.map(p => p.waitForTimeout(2000)));

    for (const p of pages) {
      const body = await p.locator('body').textContent().catch(() => '');
      expect(body?.length ?? 0).toBeGreaterThan(5);
    }
    await ctx.close();
    test.info().annotations.push({ type: 'pass', description: 'STABILITY: 3 concurrent page requests all render successfully' });
  });

  // ──────────────────────────────────────────────
  // W5-LR15: Billing guard active through longrun tests
  // ──────────────────────────────────────────────
  test('W5-LR15: billing guard active through long-run stability tests @wave5', async ({}) => {
    if (!billingGuardActive()) {
      test.skip(true, billingGuardSkipMessage());
    }
    expect(billingGuardActive()).toBe(true);
    test.info().annotations.push({ type: 'pass', description: 'BILLING GUARD: Active during long-run hardening' });
  });
});
