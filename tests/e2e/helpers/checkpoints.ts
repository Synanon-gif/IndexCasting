import type { Locator, TestInfo } from '@playwright/test';
import { expect } from '../fixtures/base';

/** Per-test checkpoint trail (reset by `fixtures/base` before each test). */
let checkpoints: string[] = [];
let lastClickLabel = '';

export function resetCheckpointState(): void {
  checkpoints = [];
  lastClickLabel = '';
}

export function getCheckpointReport(): { checkpoints: string[]; lastClickLabel: string } {
  return { checkpoints: [...checkpoints], lastClickLabel };
}

export function checkpoint(testInfo: TestInfo, name: string): void {
  const line = `${new Date().toISOString()} ${name}`;
  checkpoints.push(line);
  testInfo.annotations.push({ type: 'checkpoint', description: name });
}

export async function clickAndCheckpoint(
  locator: Locator,
  label: string,
  testInfo: TestInfo,
): Promise<void> {
  checkpoint(testInfo, `click → ${label}`);
  lastClickLabel = label;
  await locator.click();
}

export async function expectVisibleCheckpoint(
  locator: Locator,
  label: string,
  testInfo: TestInfo,
  options?: { timeout?: number },
): Promise<void> {
  checkpoint(testInfo, `expect visible → ${label}`);
  await expect(locator).toBeVisible({ timeout: options?.timeout ?? 15_000 });
}
