/**
 * E2E preflight — no @p0 tag (excluded from `e2e:p0` grep).
 * Writes `docs/e2e-preflight-report.md` and `e2e-artifacts/preflight-workspace-state.json`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import {
  PREFLIGHT_WORKSPACE_STATE_PATH,
  RUNTIME_B2B_BLOCK_PATH,
  writePreflightWorkspaceState,
  type PreflightRoleResult,
  type PreflightSuspectedCause,
  type PreflightWorkspaceStateV1,
} from './helpers/b2bWorkspaceGate';
import { prepareAuthScreenForCredentialLogin, signInAs } from './helpers/auth';
import type { E2EAccountRole } from './helpers/env';
import { getBaseUrl } from './helpers/env';
import { buildPreflightStaticSection } from './helpers/preflightEnv';

function unlinkQuiet(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    /* ok */
  }
}

function inferSuspectedCause(
  err: unknown,
  parityLine: string | null,
): { errorCode: string; suspectedCause: PreflightSuspectedCause } {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credential|PLAYWRIGHT_TEST_PASSWORD|E2E_SEED_USER_PASSWORD|password/i.test(msg)) {
    return { errorCode: 'E2E_CREDENTIAL_CONFIG', suspectedCause: 'wrong_password' };
  }
  if (/E2E_AUTH_STUCK_SIGNUP/i.test(msg)) {
    if (parityLine) {
      return { errorCode: 'E2E_AUTH_STUCK_SIGNUP', suspectedCause: 'seed_db_mismatch' };
    }
    return { errorCode: 'E2E_AUTH_STUCK_SIGNUP', suspectedCause: 'signup_mode_stuck' };
  }
  if (/E2E_AUTH_SHELL_TIMEOUT/i.test(msg)) {
    return { errorCode: 'E2E_AUTH_SHELL_TIMEOUT', suspectedCause: 'shell_timeout' };
  }
  if (/legal|Terms of Service|Accept & Continue/i.test(msg)) {
    return { errorCode: 'E2E_LEGAL_GATE', suspectedCause: 'legal_gate_stuck' };
  }
  if (/timeout|exceeded/i.test(msg)) {
    return { errorCode: 'E2E_TIMEOUT', suspectedCause: 'selector_drift' };
  }
  return { errorCode: 'E2E_UNKNOWN', suspectedCause: 'unknown' };
}

async function authSurfaceHints(page: import('@playwright/test').Page): Promise<string> {
  const hints: string[] = [];
  const checks: [string, import('@playwright/test').Locator][] = [
    ['Create Account', page.getByText(/^Create Account$/i).first()],
    ['Org name field', page.getByPlaceholder(/Organization name/i).first()],
    ['Dashboard', page.getByText('Dashboard', { exact: true }).first()],
    ['Logout', page.getByText(/^Logout$/i).filter({ visible: true }).first()],
    ['Discover tab', page.getByRole('tab', { name: /^Discover$/i }).first()],
    ['My Models tab', page.getByRole('tab', { name: /^My Models$/i }).first()],
    ['Home tab', page.getByRole('tab', { name: /^Home$/i }).first()],
    ['Legal / Terms gate', page.getByText(/I accept the Terms of Service/i).filter({ visible: true }).first()],
  ];
  for (const [label, loc] of checks) {
    if (await loc.isVisible().catch(() => false)) hints.push(label);
  }
  return hints.length ? hints.join(', ') : '(no known workspace/auth chrome matched)';
}

async function probeLogin(
  browser: import('@playwright/test').Browser,
  role: E2EAccountRole,
  parityLine: string | null,
): Promise<PreflightRoleResult> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await signInAs(page, role, { preflight: true });
    const hints = await authSurfaceHints(page);
    return { ok: true, notes: `workspace hints: ${hints}` };
  } catch (e) {
    const { errorCode, suspectedCause } = inferSuspectedCause(e, parityLine);
    const hints = await authSurfaceHints(page).catch(() => '(hints failed)');
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorCode,
      suspectedCause,
      notes: `${msg.slice(0, 220)} | visible: ${hints}`,
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function renderReport(state: PreflightWorkspaceStateV1, staticNotes: string[]): string {
  const lines: string[] = [
    '# E2E preflight report',
    '',
    `- **Generated:** ${state.generatedAt}`,
    `- **baseUrlClass:** ${state.baseUrlClass}`,
    `- **e2eBaseHost (host only):** ${state.e2eBaseHost ?? '—'}`,
    '',
    '## Environment (presence only — no secret values)',
    '',
    `- **.env.e2e present:** ${state.env.dotenvE2ePresent}`,
    `- **password vars configured:** ${state.env.passwordConfigured}`,
    `- **password vars aligned:** ${state.env.passwordVarsAligned}`,
    `- **seed manifest present:** ${state.env.manifestPresent}`,
    `- **parity line:** ${state.env.parityWarning ?? 'none'}`,
    '',
    '## Reachability & auth chrome',
    '',
    ...staticNotes.map((s) => `- ${s}`),
    '',
    '## Login probe by role',
    '',
    '### Agency owner (B2B)',
    `- **ok:** ${state.agency.ok}`,
    `- **errorCode:** ${state.agency.errorCode ?? '—'}`,
    `- **suspectedCause:** ${state.agency.suspectedCause ?? '—'}`,
    `- **notes:** ${state.agency.notes ?? '—'}`,
    '',
    '### Client owner (B2B)',
    `- **ok:** ${state.client.ok}`,
    `- **errorCode:** ${state.client.errorCode ?? '—'}`,
    `- **suspectedCause:** ${state.client.suspectedCause ?? '—'}`,
    `- **notes:** ${state.client.notes ?? '—'}`,
    '',
    '### Linked model',
    `- **ok:** ${state.model.ok}`,
    `- **errorCode:** ${state.model.errorCode ?? '—'}`,
    `- **suspectedCause:** ${state.model.suspectedCause ?? '—'}`,
    `- **notes:** ${state.model.notes ?? '—'}`,
    '',
    '## Recommendation',
    '',
    state.agency.ok && state.client.ok
      ? '- B2B preflight **passed** — safe to run `e2e:b2b` / `e2e:p0` (write gates still off unless you enable them).'
      : '- **Do not run full P0** until B2B login is green — use `npm run e2e:preflight` after fixing env/seed parity. Dependent B2B specs will skip early when this report shows failures (see `e2e-artifacts/preflight-workspace-state.json`).',
    '',
    '### Suspected cause legend',
    '',
    '| Value | Meaning |',
    '|-------|---------|',
    '| wrong_password | Missing/mismatched `PLAYWRIGHT_TEST_PASSWORD` / `E2E_SEED_USER_PASSWORD` |',
    '| user_missing_in_supabase | User for role likely absent on target project (use seed or check emails) |',
    '| seed_db_mismatch | `POSSIBLE ENV PARITY MISMATCH` or STUCK_SIGNUP with manifest/env host skew |',
    '| legal_gate_stuck | Terms/legal acceptance not dismissible |',
    '| signup_mode_stuck | `E2E_AUTH_STUCK_SIGNUP` without parity line |',
    '| selector_drift | Timeouts / shell not found — harness may need map updates |',
    '| shell_timeout | `E2E_AUTH_SHELL_TIMEOUT` |',
    '| unknown | See notes |',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

test.describe.configure({ mode: 'serial' });

test.describe('E2E preflight probe', () => {
  test.setTimeout(240_000);

  test('static checks, reachability, auth chrome, B2B+model login probes', async ({
    browser,
    request,
    baseURL,
  }) => {
    unlinkQuiet(PREFLIGHT_WORKSPACE_STATE_PATH);
    unlinkQuiet(RUNTIME_B2B_BLOCK_PATH);

    const static_ = buildPreflightStaticSection();
    const parityLine = static_.parityWarning;
    const staticNotes: string[] = [];

    const base = baseURL?.replace(/\/$/, '') || getBaseUrl().replace(/\/$/, '');
    let httpOk = false;
    let httpStatus = 0;
    try {
      const res = await request.get(`${base}/`, { timeout: 45_000 });
      httpStatus = res.status();
      httpOk = res.ok() || (httpStatus >= 200 && httpStatus < 500);
      staticNotes.push(`GET / → HTTP ${httpStatus} (${httpOk ? 'acceptable' : 'bad'})`);
    } catch (e) {
      staticNotes.push(`GET / failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    let authEmailVisible = false;
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await page.goto(`${base}/`);
        await page.waitForLoadState('domcontentloaded');
        await prepareAuthScreenForCredentialLogin(page);
        const emailPh = page.getByPlaceholder(/^(Email|E-mail|Email address)$/i).first();
        authEmailVisible = await emailPh.isVisible().catch(() => false);
        staticNotes.push(`Auth email field visible after prepareAuth: ${authEmailVisible}`);
      } catch (e) {
        staticNotes.push(`Auth chrome probe error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }

    let agency: PreflightRoleResult;
    let client: PreflightRoleResult;
    let model: PreflightRoleResult;

    if (!static_.password.passwordConfigured || !static_.password.passwordVarsAligned) {
      const bad: PreflightRoleResult = {
        ok: false,
        errorCode: 'E2E_ENV_PASSWORD',
        suspectedCause: 'wrong_password',
        notes: static_.password.detail,
      };
      agency = bad;
      client = bad;
      model = bad;
      staticNotes.push('Login probes skipped — password env not configured or misaligned.');
    } else {
      agency = await probeLogin(browser, 'agencyOwner', parityLine);
      client = await probeLogin(browser, 'clientOwner', parityLine);
      model = await probeLogin(browser, 'modelLinked', parityLine);
    }

    const state: PreflightWorkspaceStateV1 = {
      version: 1,
      generatedAt: new Date().toISOString(),
      baseUrlClass: static_.baseUrlClass,
      e2eBaseHost: static_.baseUrlHost,
      agency,
      client,
      model,
      env: {
        dotenvE2ePresent: static_.password.dotenvE2ePresent,
        passwordConfigured: static_.password.passwordConfigured,
        passwordVarsAligned: static_.password.passwordVarsAligned,
        manifestPresent: static_.manifestPresent,
        parityWarning: parityLine ?? undefined,
      },
    };

    writePreflightWorkspaceState(state);

    const reportPath = path.join(process.cwd(), 'docs', 'e2e-preflight-report.md');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, renderReport(state, staticNotes), 'utf8');

    expect(httpOk, `Base URL must respond below 500 for preflight (got HTTP ${httpStatus} for ${base}/)`).toBe(
      true,
    );
    expect(authEmailVisible, 'Auth screen email field not visible — selector drift or app failed to load').toBe(
      true,
    );

    expect(
      state.agency.ok,
      `B2B agency owner preflight failed — ${state.agency.errorCode ?? 'n/a'} (${state.agency.suspectedCause ?? 'n/a'}): ${state.agency.notes ?? ''}`,
    ).toBe(true);
    expect(
      state.client.ok,
      `B2B client owner preflight failed — ${state.client.errorCode ?? 'n/a'} (${state.client.suspectedCause ?? 'n/a'}): ${state.client.notes ?? ''}`,
    ).toBe(true);
    expect(
      state.model.ok,
      `Model linked preflight failed — ${state.model.errorCode ?? 'n/a'} (${state.model.suspectedCause ?? 'n/a'}): ${state.model.notes ?? ''}`,
    ).toBe(true);
  });
});
