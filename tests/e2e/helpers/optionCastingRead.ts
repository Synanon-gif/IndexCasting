import type { Locator, Page } from '@playwright/test';

/**
 * Thread/detail Back on RN-web is often a Pressable `generic`, not `role="button"`.
 * Fall back to Messages → Option requests so list matchers run on the option list, not inside a thread.
 */
export async function returnToAgencyOptionRequestList(page: Page): Promise<void> {
  const backRole = page.getByRole('button', { name: /^Back$/i }).first();
  const backText = page.getByText('Back', { exact: true }).first();

  if (await backRole.isVisible().catch(() => false)) {
    await backRole.click();
  } else if (await backText.isVisible().catch(() => false)) {
    await backText.click();
  } else {
    await page.getByText('Messages', { exact: true }).first().click();
    await page.waitForTimeout(2000);
  }

  await page.waitForTimeout(500);
  const optSubtab = page.getByText('Option requests', { exact: true }).first();
  if (await optSubtab.isVisible().catch(() => false)) {
    await optSubtab.click();
    await page.waitForTimeout(1500);
  }
}

/** Primary: seed `job_description` + legacy PLAYWRIGHT copy. Fallback: model roster titles + fee cues (list rows often mirror model_name / amounts). */
export const OPTION_ROW_LINKED_CHAIN = [
  /E2E TEST — Linked option workflow|PLAYWRIGHT.*option test|availability.*fee axes|Horizon lead/i,
  /E2E TEST[—–-]\s*Model\s*05|E2E TEST — Model 05/i,
  /2\s?500|EUR.*2[\s,.]?500|€\s*2[\s,.]?500/i,
];

export const OPTION_ROW_CASTING_CHAIN = [
  /E2E TEST — Casting workflow|PLAYWRIGHT.*casting test|schedule.*negotiation/i,
  /E2E TEST[—–-]\s*Model\s*06|E2E TEST — Model 06/i,
  /1\s?800|EUR.*1[\s,.]?800|€\s*1[\s,.]?800/i,
];

export const OPTION_ROW_UNLINKED_CHAIN = [
  /E2E TEST — Unlinked option workflow|PLAYWRIGHT.*unlinked|unlinked model option|no app account path|E2E TEST.*Unlinked roster/i,
  /Unlinked roster stub|1900|EUR.*1[\s,.]?900/i,
];

/** Try each pattern in order — list UIs may show `job_description`, `model_name`, or fee digits only. */
export async function findOptionRowOrThrow(page: Page, chain: RegExp[], totalTimeoutMs: number): Promise<Locator> {
  const per = Math.max(8000, Math.floor(totalTimeoutMs / Math.max(1, chain.length)));
  let last: Error | null = null;
  for (const re of chain) {
    const loc = page.getByText(re).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: per });
      return loc;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw last ?? new Error('no option row pattern matched');
}
