/**
 * Playwright global setup — base URL reachability + safe env warnings.
 * Does not require .env.e2e (smoke can run without); logs hints only.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { FullConfig } from '@playwright/test';

import {
  RUNTIME_B2B_BLOCK_PATH,
} from './helpers/b2bWorkspaceGate';
import { getBaseUrl, logE2EEnvWarnings, pathToE2eEnvFile, warnProductionE2EAccounts } from './helpers/env';

async function globalSetup(config: FullConfig): Promise<void> {
  const fromConfig = config.projects[0]?.use?.baseURL?.trim();
  const base = fromConfig || getBaseUrl();
  const envFile = pathToE2eEnvFile();

  try {
    fs.unlinkSync(RUNTIME_B2B_BLOCK_PATH);
  } catch {
    /* fresh run — no stale runtime B2B skip file */
  }

  logE2EEnvWarnings(base);
  warnProductionE2EAccounts(base);

  if (!fs.existsSync(envFile)) {
    console.warn(
      `[e2e:global-setup] No ${path.relative(process.cwd(), envFile)} found — password-based tests will skip. Copy .env.e2e.example.`,
    );
  }

  const url = `${base.replace(/\/$/, '')}/`;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (res.status >= 500) {
      console.error(`[e2e:global-setup] Base URL returned HTTP ${res.status}: ${url}`);
    }
  } catch (e) {
    console.error(
      `[e2e:global-setup] Base URL not reachable: ${url}`,
      e instanceof Error ? e.message : e,
    );
  }
}

export default globalSetup;
