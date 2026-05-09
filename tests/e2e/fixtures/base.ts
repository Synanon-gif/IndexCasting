import { test as base, expect } from '@playwright/test';
import { resetCheckpointState } from '../helpers/checkpoints';
import { resetE2eDiagnosticContext } from '../helpers/e2eDiagnosticContext';
import { startPageDiagnostics } from '../helpers/diagnostics';

/**
 * Global per-test diagnostics: console, page errors, failed requests, 4xx/5xx.
 */
export const test = base.extend({
  _icDiagnostics: [
    async ({ page }, use, testInfo) => {
      resetCheckpointState();
      resetE2eDiagnosticContext();
      const finish = startPageDiagnostics(page, testInfo);
      await use(undefined);
      await finish();
    },
    { auto: true },
  ],
});

export { expect };
