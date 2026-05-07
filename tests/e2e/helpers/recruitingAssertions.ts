import type { Page } from '@playwright/test';

const ACTION_HINT_RE =
  /accept|reject|decline|approve|shortlist|chat|message|contact|roster|invite|view profile|open chat/i;

/**
 * Recruiting detail surfaces actions as Web `button`/`a`, a11y roles, or RN-web pressables (`div`/`span` with text).
 * We avoid destructive clicks — visibility-only signal for read-only E2E.
 */
export async function recruitingDetailShowsActionControls(page: Page): Promise<boolean> {
  for (const role of ['button', 'link'] as const) {
    const byRole = page.getByRole(role, { name: ACTION_HINT_RE });
    if (await byRole.first().isVisible().catch(() => false)) return true;
  }

  const textHits = page.getByText(ACTION_HINT_RE);
  const n = await textHits.count().catch(() => 0);
  const max = Math.min(n, 40);
  for (let i = 0; i < max; i += 1) {
    const loc = textHits.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    const mightBePressable = await loc.evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a') return true;
      let cur: HTMLElement | null = el as HTMLElement;
      for (let d = 0; d < 6 && cur; d += 1, cur = cur.parentElement) {
        const r = cur.getAttribute('role');
        if (r === 'button' || r === 'link') return true;
        const pe = window.getComputedStyle(cur).pointerEvents;
        if (pe !== 'none' && cur.tabIndex >= 0) return true;
      }
      return false;
    });
    if (mightBePressable) return true;
  }

  return false;
}
