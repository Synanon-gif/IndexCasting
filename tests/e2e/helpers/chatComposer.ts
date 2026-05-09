import type { Page } from '@playwright/test';
import { expect } from '../fixtures/base';

/** B2B / model chats: prefer last textbox; fallback textarea (RN-web). */
export async function resolveChatComposer(page: Page, timeout = 15_000) {
  const boxes = page.getByRole('textbox');
  const count = await boxes.count();
  if (count > 0) {
    const last = boxes.last();
    await expect(last).toBeVisible({ timeout });
    return last;
  }
  const ta = page.locator('textarea').last();
  await expect(ta).toBeVisible({ timeout });
  return ta;
}
