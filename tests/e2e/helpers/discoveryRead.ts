import type { Page } from '@playwright/test';
import { expect } from '../fixtures/base';
import { setE2eDiagnosticContext } from './e2eDiagnosticContext';

/** Seeded primary model name prefix from `scripts/e2e/seed-e2e-world.mjs` */
export const E2E_SEEDED_MODEL_PREFIX = 'E2E TEST';

/**
 * Mark harness context for failure-summary (read-only discovery suites).
 */
export function markDiscoveryReadContext(roleKey: string, emailDomainHint?: string): void {
  setE2eDiagnosticContext({ writeKind: 'read', roleKey, emailDomainHint });
}

/** True when seeded roster is visible (requires DB seed on target). */
export async function discoverHasSeededModels(page: Page): Promise<boolean> {
  for (let i = 0; i < 12; i += 1) {
    const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
    if (body.includes(E2E_SEEDED_MODEL_PREFIX)) {
      const counter = page.locator('text=/^\\d+\\/\\d+$/').first();
      if (await counter.isVisible().catch(() => false)) {
        const t = ((await counter.textContent()) ?? '').trim();
        const m = t.match(/^(\d+)\/(\d+)$/);
        if (m && parseInt(m[2], 10) > 0) return true;
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

export const SKIP_NO_DISCOVERY_SEED =
  'E2E discovery seed models not visible — run `npm run seed:e2e` on this database or point E2E at a seeded env. Shell-only tests still run.';

export async function expectDiscoverShellReady(page: Page): Promise<void> {
  await expect(discoverFilterToggle(page)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Discover', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Active project', { exact: true }).first()).toBeVisible();
}

/**
 * Seeded roster visible (strict) — fails if seed missing; use after conditional skip in specs.
 */
export async function assertSeededDiscoverLoaded(page: Page): Promise<void> {
  await expectDiscoverShellReady(page);
  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  expect(body).toContain(E2E_SEEDED_MODEL_PREFIX);
  const counter = page.locator('text=/^\\d+\\/\\d+$/').first();
  await expect(counter).toBeVisible({ timeout: 15_000 });
  const ct = (await counter.textContent())?.trim() ?? '0/0';
  const [, total] = ct.split('/').map((x) => parseInt(x, 10));
  expect(total, `discover counter total (${ct})`).toBeGreaterThan(0);
}

/**
 * Primary filter toggle — RN-web may not expose role; match visible label.
 */
export function discoverFilterToggle(page: Page) {
  return page.getByText(/^Filter(\s*\(\d+\))?$/).first();
}

export async function openClientDiscover(page: Page): Promise<void> {
  const discover = page
    .getByRole('tab', { name: /^Discover$/i })
    .or(page.getByText('Discover', { exact: true }).filter({ visible: true }));
  const d = discover.first();
  await d.scrollIntoViewIfNeeded().catch(() => {});
  await d.click({ timeout: 30_000 });
}

export async function ensureDiscoverFilterPanelOpen(page: Page): Promise<void> {
  const sexSection = page.getByText('Sex', { exact: true }).first();
  if (await sexSection.isVisible().catch(() => false)) return;
  await discoverFilterToggle(page).click({ timeout: 15_000 });
  await sexSection.waitFor({ state: 'visible', timeout: 15_000 });
}

export async function ensureDiscoverFilterPanelClosed(page: Page): Promise<void> {
  const sexSection = page.getByText('Sex', { exact: true }).first();
  if (!(await sexSection.isVisible().catch(() => false))) return;
  await discoverFilterToggle(page).click({ timeout: 15_000 });
  await sexSection.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/** Snapshot for failure attachments — no secrets, no tokens. */
export async function collectDiscoveryReadSnapshot(page: Page): Promise<Record<string, unknown>> {
  let pathname = '';
  let search = '';
  let scrollY = 0;
  let innerHeight = 0;
  try {
    const u = new URL(page.url());
    pathname = u.pathname;
    search = u.search;
  } catch {
    pathname = '(unparseable)';
  }
  try {
    const vp = await page.evaluate(() => ({
      scrollY: window.scrollY ?? 0,
      innerHeight: window.innerHeight ?? 0,
    }));
    scrollY = vp.scrollY;
    innerHeight = vp.innerHeight;
  } catch {
    /* closed */
  }

  let filterTriggerSample: string | null = null;
  try {
    const t = await discoverFilterToggle(page).textContent();
    filterTriggerSample = t?.replace(/\s+/g, ' ').trim() ?? null;
  } catch {
    filterTriggerSample = null;
  }

  let counterSample: string | null = null;
  try {
    const counter = page.locator('text=/^\\d+\\/\\d+$/').first();
    if (await counter.isVisible().catch(() => false)) {
      counterSample = (await counter.textContent())?.trim() ?? null;
    }
  } catch {
    counterSample = null;
  }

  let activeFilterBanner = false;
  let activeFilterBannerSample: string[] = [];
  try {
    const fe = page.getByText('Filtered by:', { exact: true }).first();
    activeFilterBanner = await fe.isVisible().catch(() => false);
    if (activeFilterBanner) {
      const raw = (await page.getByText('Filtered by:', { exact: true }).first().evaluate((el) => {
        const p = (el.parentElement as HTMLElement | null)?.innerText ?? el.textContent ?? '';
        return p;
      })) as string;
      activeFilterBannerSample = raw
        .split(/\n/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 12);
    }
  } catch {
    activeFilterBanner = false;
  }

  const noMoreModelsVisible = await page
    .getByText('No more models right now.', { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const discoverHeaderVisible = await page
    .getByText('Discover', { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const activeProjectVisible = await page
    .getByText('Active project', { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const loadingGuestVisible = await page
    .getByText(/^Loading…$/u)
    .first()
    .isVisible()
    .catch(() => false);
  const spinners = await page
    .locator(
      '[data-testid="activity-indicator"], [aria-busy="true"], [class*="ActivityIndicator"]',
    )
    .count()
    .catch(() => 0);

  const bottomTabLabels = (
    await page
      .getByRole('tab')
      .allTextContents()
      .catch(() => [])
  )
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 24);

  let bodySnippet = '';
  try {
    const body = (await page.locator('body').textContent()) ?? '';
    bodySnippet = body.replace(/\s+/g, ' ').trim().slice(0, 8000);
  } catch {
    bodySnippet = '';
  }

  const cardNameHits: string[] = [];
  try {
    const re = new RegExp(`${E2E_SEEDED_MODEL_PREFIX}\\s*[—-]\\s*Model\\s*\\d+`, 'gi');
    const m = bodySnippet.match(re);
    if (m) cardNameHits.push(...m.slice(0, 3));
  } catch {
    /* ignore */
  }

  return {
    pathname,
    search,
    scrollY,
    innerHeight,
    filterTriggerSample,
    discoverCounter: counterSample,
    activeFilterBanner,
    activeFilterBannerSample,
    noMoreModelsVisible,
    discoverHeaderVisible,
    activeProjectVisible,
    loadingEllipsisVisible: loadingGuestVisible,
    busyIndicatorsApprox: spinners,
    bottomTabLabelsSample: bottomTabLabels,
    bodySnippet,
    cardNameHitsSample: cardNameHits,
  };
}
