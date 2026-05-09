import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { applyWorkspaceGateOrSkip, recordRuntimeB2bStuckSignup } from './b2bWorkspaceGate';
import type { E2EAccountRole } from './env';
import { emailForRole, getTestPassword } from './env';

const AUTH_FORM_MS = 20_000;
/** Post-login workspace wait — capped to fail fast when signup chrome relapses (was 60s). */
const AUTH_SHELL_MS = 42_000;
/** Single-attempt preflight probes — short cap so `e2e:preflight` stays fast. */
const PREFLIGHT_SHELL_MS = 22_000;
/** Canonical `uiCopy.legal.title` — match case-insensitive for CSS/transform drift on web. */
const LEGAL_ACCEPTANCE_TITLE_RE = /^Terms\s*&\s*Conditions$/i;
/** Cumulative auth-helper diagnostics (no secrets). Playwright also attaches per-test failure-summary.md on test fail. */
const AUTH_FAILURE_SUMMARY_PATH = path.join(process.cwd(), 'e2e-artifacts', 'failure-summary.md');

type AuthUiDiagnostics = {
  url: string;
  buttonTexts: string[];
  headings: string[];
  formLabels: string[];
  authHints: string[];
};

/** AuthScreen tab / chrome to leave self-service Sign up — tolerate “Login” vs “Sign in” (A11y + copy drift). */
function loginModeTabLocator(page: Page): Locator {
  return page
    .getByRole('tab', { name: /^(Login|Sign in|Log in)$/i })
    .or(page.getByRole('button', { name: /^(Login|Sign in|Log in)$/i }))
    .or(page.getByText(/^Login$/i))
    .or(page.getByText(/^Sign in$/i))
    .or(page.getByText(/^Log in$/i));
}

function legalAcceptanceGateLocator(page: Page): Locator {
  return page.getByText(LEGAL_ACCEPTANCE_TITLE_RE).filter({ visible: true });
}

/** Agency LegalAcceptance shows a third checkbox; client B2B does not. */
function b2bRequiresAgencyRightsCheckbox(role: E2EAccountRole): boolean {
  return role === 'agencyOwner' || role === 'booker';
}

async function collectAuthUiDiagnostics(page: Page): Promise<AuthUiDiagnostics> {
  const url = page.url();
  let buttonTexts: string[] = [];
  let headings: string[] = [];
  let formLabels: string[] = [];
  /** Short inline hints for auth failures (no secrets). */
  let authHints: string[] = [];
  try {
    /** RN Web often uses focusable divs instead of `role="button"`. */
    buttonTexts = (
      await page
        .locator('button, [role="button"], [tabindex="0"]')
        .filter({ visible: true })
        .allTextContents()
    )
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0 && t.length < 120)
      .slice(0, 40);
    headings = (await page.locator('h1, h2, h3').filter({ visible: true }).allTextContents())
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 25);
    formLabels = (await page.locator('label').filter({ visible: true }).allTextContents())
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 25);
    const cta = await page.getByText(/^Create Account$/i).filter({ visible: true }).count();
    const forgot = await page.getByText(/^Forgot password\?$/i).filter({ visible: true }).count();
    const loginNodes = await page.getByText(/^Login$/i).count();
    const expl = await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count();
    const orgPh = await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count();
    authHints = [
      `visible “Create Account” count: ${cta}`,
      `visible “Forgot password?” count: ${forgot}`,
      `“Login” text node count (any visibility): ${loginNodes}`,
      `visible signup explainer count: ${expl}`,
      `visible “Organization name” placeholder count: ${orgPh}`,
    ];
    try {
      const alertish = page.locator('[role="alert"]').filter({ visible: true });
      const nA = await alertish.count();
      if (nA > 0) {
        const t = (await alertish.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        if (t) authHints.push(`role=alert text (truncated): ${t.slice(0, 200)}`);
      }
      const body = ((await page.locator('body').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ');
      const m = body.match(/\b(invalid|incorrect|wrong password|failed to sign|could not sign|error)\b[^.]{0,120}/i);
      if (m) authHints.push(`body error hint (redacted slice): ${m[0].slice(0, 160)}`);
    } catch {
      // ignore
    }
  } catch {
    // page may be unavailable
  }
  return { url, buttonTexts, headings, formLabels, authHints };
}

async function closeTopBlockingDialogIfPresent(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const close = page.getByRole('button', { name: /^Close$/i }).filter({ visible: true });
    if ((await close.count()) === 0) return;
    await close.first().click();
    await page.waitForTimeout(250);
  }
}

/**
 * Completes `LegalAcceptanceScreen` when shown (read-only E2E — mirrors product copy, no secrets).
 * Model: two "I accept the" rows + Accept & Continue. Agency: optional third rights row.
 */
export async function dismissLegalAcceptanceIfPresent(
  page: Page,
  opts: { requireAgencyRightsCheckbox: boolean },
): Promise<void> {
  const gate = legalAcceptanceGateLocator(page);
  if ((await gate.count()) === 0) return;

  await closeTopBlockingDialogIfPresent(page);

  const tosRow = page.getByText(/I accept the Terms of Service/i).filter({ visible: true }).first();
  const privacyRow = page.getByText(/I accept the Privacy Policy/i).filter({ visible: true }).first();
  await expect(tosRow).toBeVisible({ timeout: 10_000 });
  await expect(privacyRow).toBeVisible({ timeout: 10_000 });
  /** Tap left of label text so nested “Terms of Service” / “Privacy Policy” links do not open modals. */
  await tosRow.click({ force: true, position: { x: 12, y: 12 } });
  await privacyRow.click({ force: true, position: { x: 12, y: 12 } });

  if (opts.requireAgencyRightsCheckbox) {
    const rights = page.getByText(/I confirm that I hold all necessary rights/i).filter({ visible: true });
    if (await rights.count()) await rights.first().click({ force: true, position: { x: 12, y: 12 } });
  }

  await closeTopBlockingDialogIfPresent(page);

  const submit = page
    .getByRole('button', { name: /accept\s*&\s*continue/i })
    .filter({ visible: true })
    .first()
    .or(page.getByText(/^Accept & Continue$/i).filter({ visible: true }).first());
  await expect(submit).toBeVisible({ timeout: 15_000 });
  await submit.click({ force: true });

  const stillGate = await legalAcceptanceGateLocator(page)
    .first()
    .isVisible()
    .catch(() => false);
  if (stillGate) {
    await closeTopBlockingDialogIfPresent(page);
    await tosRow.click({ force: true, position: { x: 12, y: 12 } });
    await privacyRow.click({ force: true, position: { x: 12, y: 12 } });
    await submit.click({ force: true });
  }

  await expect(legalAcceptanceGateLocator(page)).toHaveCount(0, { timeout: 35_000 });
}

function appendAuthFailureSummaryMd(
  role: E2EAccountRole,
  diag: AuthUiDiagnostics,
  reason: string,
): void {
  const stamp = new Date().toISOString();
  const block = [
    '',
    `## Auth helper (${stamp})`,
    '',
    `- **reason:** ${reason}`,
    `- **role (harness):** ${role}`,
    `- **URL:** ${diag.url}`,
    '',
    '### Form / auth hints',
    ...diag.authHints.map((h) => `- ${h}`),
    '',
    '### Visible button-like text (sample)',
    ...diag.buttonTexts.map((b) => `- ${b}`),
    '',
    '### Visible headings (sample)',
    ...diag.headings.map((h) => `- ${h}`),
    '',
    '### Visible form labels (sample)',
    ...diag.formLabels.map((l) => `- ${l}`),
    '',
    '---',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(AUTH_FAILURE_SUMMARY_PATH), { recursive: true });
    fs.appendFileSync(AUTH_FAILURE_SUMMARY_PATH, block, 'utf8');
  } catch (e) {
    console.error('[e2e/signInAs] could not append failure-summary:', e);
  }
}

function emailFieldLocator(page: Page) {
  return page
    .getByPlaceholder(/^(Email|E-mail|Email address)$/i)
    .or(page.locator('input[type="email"]'))
    .or(page.locator('input[autocomplete="email"]'))
    .or(page.locator('input[autocomplete="username"]'))
    .first();
}

function passwordFieldLocator(page: Page) {
  return page
    .getByPlaceholder(/^(Password|Passcode)$/i)
    .or(page.locator('input[type="password"]'))
    .first();
}

async function exitForgotPasswordIfNeeded(page: Page): Promise<void> {
  const forgotHeading = page.getByText(/^Reset your password$/i).first();
  if (!(await forgotHeading.isVisible().catch(() => false))) return;
  const back = page.getByRole('button', { name: /^Back to login$/i }).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await expect(forgotHeading).toBeHidden({ timeout: 10_000 });
  }
}

/** Must be visibility-checked — hidden nodes in the tree must not satisfy login-mode. */
async function isLoginModeForgotLinkVisible(page: Page): Promise<boolean> {
  return page.getByText(/^Forgot password\?$/i).first().isVisible().catch(() => false);
}

/**
 * Sign-up branch shows “Create Account”; login branch should not (harness-only heuristic).
 */
async function isSignUpBranchVisible(page: Page): Promise<boolean> {
  return page.getByText(/^Create Account$/i).first().isVisible().catch(() => false);
}

/** Plain AuthScreen exposes this explainer only on the self-service Sign up branch (not credential login). */
const SIGNUP_EXPLAINER_PATTERN = /first signup as Client or Agency/i;

async function waitForCredentialLoginBranchVisible(page: Page, timeoutMs: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const org = await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count();
        const ca = await page.getByText(/^Create Account$/i).filter({ visible: true }).count();
        const expl = await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count();
        const dn = await page.getByPlaceholder(/^Display name$/i).filter({ visible: true }).count();
        const rules = await page.getByText(/Min\. 10 characters/u).filter({ visible: true }).count();
        return org === 0 && ca === 0 && expl === 0 && dn === 0 && rules === 0;
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

/**
 * RN Web AuthScreen keeps Sign-up fields in the DOM; visibility heuristics can false-positive “login”.
 * Drive the same tab sequence a human would: explicitly open Sign up, then Login.
 */
async function forcePlainAuthTabsToLogin(page: Page): Promise<void> {
  const signUpTab = page.getByText(/^Sign Up$/i).first();
  if (await signUpTab.isVisible().catch(() => false)) {
    await signUpTab.click({ force: true });
  }
  const createAccount = page.getByText(/^Create Account$/i).filter({ visible: true });
  await expect(createAccount.first())
    .toBeVisible({ timeout: 6_000 })
    .catch(() => undefined);

  const loginTab = loginModeTabLocator(page).first();
  await expect(loginTab).toBeVisible({ timeout: 25_000 });
  await loginTab.click({ force: true });
  await expect(emailFieldLocator(page)).toBeVisible({ timeout: 10_000 });
  await waitForCredentialLoginBranchVisible(page, 12_000);
}

async function ensureLoginMode(page: Page): Promise<void> {
  await exitForgotPasswordIfNeeded(page);
  const start = Date.now();
  const budgetMs = 20_000;
  while (Date.now() - start < budgetMs) {
    if ((await isLoginModeForgotLinkVisible(page)) && !(await isSignUpBranchVisible(page))) {
      return;
    }
    /**
     * Hosted RN Web defaults to Sign up; “Forgot password?” may be absent until the Login tab wins.
     * When sign-up-only chrome is gone (no visible Create Account / password-rules hint / Display name),
     * we treat the screen as credential-login-ready even if the forgot link is not exposed.
     */
    const noSignUpChrome =
      !(await isSignUpBranchVisible(page)) &&
      (await page.getByText(/Min\. 10 characters/u).filter({ visible: true }).count()) === 0 &&
      (await page.getByPlaceholder(/^Display name$/i).filter({ visible: true }).count()) === 0 &&
      (await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count()) === 0 &&
      (await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count()) === 0;
    if (noSignUpChrome) {
      return;
    }

    await loginModeTabLocator(page).first().click({ force: true });
    await expect(emailFieldLocator(page)).toBeVisible({ timeout: 8_000 });
    await waitForCredentialLoginBranchVisible(page, 8_000).catch(() => undefined);
  }
  throw new Error(
    'Auth screen did not leave Sign up layout after repeated Login tab actions (hosted RN Web / AuthScreen).',
  );
}

/**
 * If signup chrome reappeared (e.g. AuthScreen remount), switch back to login and restore fields.
 */
async function recoverLoginBranchAndRefillIfNeeded(page: Page, email: string, password: string): Promise<void> {
  const hint = page.getByText(/Min\. 10 characters/u).filter({ visible: true }).first();
  const cta = page.getByText(/^Create Account$/i).filter({ visible: true }).first();
  const orgName = page.getByPlaceholder(/Organization name/i).filter({ visible: true }).first();
  const expl = page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).first();
  if (
    !(await page.getByPlaceholder(/^Display name$/i).filter({ visible: true }).first().isVisible().catch(() => false)) &&
    !(await hint.isVisible().catch(() => false)) &&
    !(await cta.isVisible().catch(() => false)) &&
    !(await orgName.isVisible().catch(() => false)) &&
    !(await expl.isVisible().catch(() => false))
  ) {
    return;
  }
  await ensureLoginMode(page);
  await assertReadyToCredentialSignIn(page);
  await emailFieldLocator(page).fill(email);
  await passwordFieldLocator(page).fill(password);
}

/**
 * After `ensureLoginMode`, reject lingering Sign up layout (password hint / create CTA) without
 * requiring “Forgot password?” (omitted on invite/claim AuthScreen).
 */
async function assertReadyToCredentialSignIn(page: Page): Promise<void> {
  await expect(page.getByText(/^Create Account$/i).filter({ visible: true })).toHaveCount(0, {
    timeout: AUTH_FORM_MS,
  });
  await expect(page.getByText(/Min\. 10 characters/u).filter({ visible: true })).toHaveCount(0, {
    timeout: AUTH_FORM_MS,
  });
  await expect(page.getByPlaceholder(/^Display name$/i).filter({ visible: true })).toHaveCount(0, {
    timeout: AUTH_FORM_MS,
  });
  /** Sign-up tab exposes org branding field; plain credential login must not. */
  await expect(page.getByPlaceholder(/Organization name/i).filter({ visible: true })).toHaveCount(0, {
    timeout: AUTH_FORM_MS,
  });
  await expect(page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true })).toHaveCount(0, {
    timeout: AUTH_FORM_MS,
  });
  /** Plain AuthScreen login branch exposes this link; invite/claim layouts omit it (no visible nodes). */
  const forgotVisible = page.getByText(/^Forgot password\?$/i).filter({ visible: true });
  if ((await forgotVisible.count()) > 0) {
    await expect(forgotVisible.first()).toBeVisible({ timeout: 8_000 });
  }
}

/**
 * AuthScreen labels the primary submit with `uiCopy.auth.loginTab` (“Login”) — same string as the
 * mode tab. In login mode there are **two** visible “Login” texts (tab + submit); sign-up mode
 * only has the tab.
 */
async function tryClickPlainAuthLoginSubmit(page: Page): Promise<boolean> {
  const logins = page.getByText(/^Login$/i);
  const n = await logins.count();
  if (n >= 2) {
    await logins.nth(1).click({ force: true });
    return true;
  }
  if (n === 1 && (await isLoginModeForgotLinkVisible(page)) && !(await isSignUpBranchVisible(page))) {
    /**
     * Single visible “Login” + confirmed login branch: RN Web may flatten tab+submit oddly —
     * fall back to geometry (submit below password).
     */
    return clickLoginSubmitBelowPassword(page);
  }
  return false;
}

type SubmitPattern = RegExp;

/** Order matters: specific phrases before bare “Continue”. */
const SUBMIT_NAME_PATTERNS: SubmitPattern[] = [
  /^Login$/i,
  /^Sign in$/i,
  /^Log in$/i,
  /^Continue with email$/i,
  /^Continue$/i,
];

/**
 * Prefer later DOM matches so the primary submit wins over the “Login” mode tab
 * (same copy on AuthScreen).
 */
async function clickVisibleEnabledInOrder(
  group: ReturnType<Page['getByRole']> | ReturnType<Page['locator']>,
  count: number,
): Promise<boolean> {
  for (let i = count - 1; i >= 0; i--) {
    const loc = group.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      if (await loc.isEnabled().catch(() => false)) {
        await loc.click({ force: true });
        return true;
      }
    }
  }
  return false;
}

async function clickSubmitByRoleButton(page: Page, pattern: SubmitPattern): Promise<boolean> {
  const group = page.getByRole('button', { name: pattern });
  const n = await group.count();
  if (n === 0) return false;
  return clickVisibleEnabledInOrder(group, n);
}

/**
 * React Native Web: some touchables are focusable divs with role="button".
 */
async function clickSubmitByRoleButtonDiv(page: Page, pattern: SubmitPattern): Promise<boolean> {
  const group = page.locator('[role="button"]').filter({ visible: true }).filter({ hasText: pattern });
  const n = await group.count();
  if (n === 0) return false;
  return clickVisibleEnabledInOrder(group, n);
}

/**
 * RN Web `TouchableOpacity` often exposes no ARIA role; text content still matches.
 * Prefer later nodes so the primary submit wins over the “Login” mode tab when both read “Login”.
 */
async function clickSubmitByVisibleText(page: Page, pattern: SubmitPattern): Promise<boolean> {
  const group = page.getByText(pattern);
  const n = await group.count();
  if (n === 0) return false;
  for (let i = n - 1; i >= 0; i--) {
    const loc = group.nth(i);
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ force: true });
      return true;
    }
  }
  return false;
}

const LOGIN_SUBMIT_PATTERN = /^Login$/i;

/**
 * AuthScreen uses “Login” for both the mode tab and the primary submit. Prefer controls whose
 * vertical center is **below** the bottom of the password field (submit), not the header tab.
 */
async function collectVisibleClickablesBelowPassword(
  page: Page,
  group: Locator,
): Promise<{ loc: Locator; y: number }[]> {
  const passwordField = passwordFieldLocator(page);
  const pwdBox = await passwordField.boundingBox().catch(() => null);
  const n = await group.count();
  const candidates: { loc: Locator; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const loc = group.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    if (!(await loc.isEnabled().catch(() => true))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    const cy = box.y + box.height / 2;
    if (pwdBox && cy < pwdBox.y + pwdBox.height - 2) continue;
    candidates.push({ loc, y: cy });
  }
  return candidates;
}

async function clickLoginSubmitBelowPassword(page: Page): Promise<boolean> {
  const tryClickLowest = async (group: Locator): Promise<boolean> => {
    const c = await collectVisibleClickablesBelowPassword(page, group);
    if (c.length === 0) return false;
    c.sort((a, b) => b.y - a.y);
    await c[0].loc.click({ force: true });
    return true;
  };

  if (await tryClickLowest(page.getByRole('button', { name: LOGIN_SUBMIT_PATTERN }))) return true;
  if (
    await tryClickLowest(
      page.locator('[role="button"]').filter({ visible: true }).filter({ hasText: LOGIN_SUBMIT_PATTERN }),
    )
  ) {
    return true;
  }

  const textGroup = page.getByText(LOGIN_SUBMIT_PATTERN);
  const n = await textGroup.count();
  if (n === 0) return false;
  const passwordField = passwordFieldLocator(page);
  const pwdBox = await passwordField.boundingBox().catch(() => null);
  const candidates: { loc: Locator; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const loc = textGroup.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    const cy = box.y + box.height / 2;
    if (pwdBox && cy < pwdBox.y + pwdBox.height - 2) continue;
    candidates.push({ loc, y: cy });
  }
  if (candidates.length === 0) {
    /**
     * Do not fall back to bare `getByText(/^Login$/)` — on RN Web the only visible match is often the
     * mode tab (above the password). That click is not a submit and would skip the next patterns
     * (“Sign in” / “Log in”) in `tryClickAuthSubmit`.
     */
    return false;
  }
  candidates.sort((a, b) => b.y - a.y);
  await candidates[0].loc.click({ force: true });
  return true;
}

/** Returns true if a concrete button-like control was clicked (not Enter-only). */
async function tryClickAuthSubmit(page: Page): Promise<boolean> {
  for (const pattern of SUBMIT_NAME_PATTERNS) {
    if (pattern.source.startsWith('^Login')) {
      if (await tryClickPlainAuthLoginSubmit(page)) return true;
      if (await clickLoginSubmitBelowPassword(page)) return true;
      continue;
    }
    if (await clickSubmitByRoleButton(page, pattern)) return true;
  }
  for (const pattern of SUBMIT_NAME_PATTERNS) {
    if (pattern.source.startsWith('^Login')) continue;
    if (await clickSubmitByRoleButtonDiv(page, pattern)) return true;
  }
  for (const pattern of SUBMIT_NAME_PATTERNS) {
    if (pattern.source.startsWith('^Login')) continue;
    if (await clickSubmitByVisibleText(page, pattern)) return true;
  }
  return false;
}

async function assertAuthenticatedShell(
  page: Page,
  role: E2EAccountRole,
  shellTimeoutMs: number = AUTH_SHELL_MS,
): Promise<void> {
  const signupChromeVisible = async (): Promise<boolean> => {
    const org = await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count();
    const ca = await page.getByText(/^Create Account$/i).filter({ visible: true }).count();
    const expl = await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count();
    const rules = await page.getByText(/Min\. 10 characters/u).filter({ visible: true }).count();
    const dn = await page.getByPlaceholder(/^Display name$/i).filter({ visible: true }).count();
    return org > 0 || ca > 0 || expl > 0 || rules > 0 || dn > 0;
  };

    const shellVisible = async (): Promise<boolean> => {
      if (role === 'modelLinked') {
        const legalGate = legalAcceptanceGateLocator(page);
        if (await legalGate.first().isVisible().catch(() => false)) return true;
        const home = page.getByText(/^Home$/).or(page.getByRole('tab', { name: /^Home$/i }));
        const complianceTerms = page.getByText(/I accept the Terms of Service/i).filter({ visible: true });
        if (await complianceTerms.first().isVisible().catch(() => false)) return true;
        if (await home.first().isVisible().catch(() => false)) return true;
        return false;
      }
      /**
       * B2B: Hosted `LegalAcceptanceScreen` can mount immediately after login. `Logout` may remain
       * visible in header chrome while "Terms & Conditions" blocks the dashboard — do not treat
       * as workspace-ready until the gate is cleared (handled in the polling loop).
       */
      if (await legalAcceptanceGateLocator(page).first().isVisible().catch(() => false)) return false;

      const dashboard = page
        .getByText('Dashboard', { exact: true })
        .or(page.getByRole('tab', { name: /^Dashboard$/i }));
      const logout = page.getByText(/^Logout$/i).filter({ visible: true });
    if (await dashboard.first().isVisible().catch(() => false)) return true;
    if (await logout.first().isVisible().catch(() => false)) return true;
    if (role === 'agencyOwner' || role === 'booker') {
      const myModels = page
        .getByRole('tab', { name: /^My Models$/i })
        .or(page.getByText('My Models', { exact: true }).filter({ visible: true }));
      if (await myModels.first().isVisible().catch(() => false)) return true;
    } else if (role === 'clientOwner' || role === 'clientTeam') {
      const discover = page
        .getByRole('tab', { name: /^Discover$/i })
        .or(page.getByText('Discover', { exact: true }).filter({ visible: true }));
      if (await discover.first().isVisible().catch(() => false)) return true;
    }
    return false;
  };

  const deadline = Date.now() + shellTimeoutMs;
  /** Model: avoid treating a transient Home flash (before LegalAcceptance mounts) as shell. */
  let modelHomeTicks = 0;

  while (Date.now() < deadline) {
    if (await signupChromeVisible()) {
      try {
        const diag = await collectAuthUiDiagnostics(page);
        appendAuthFailureSummaryMd(
          role,
          diag,
          'E2E_AUTH_STUCK_SIGNUP — signup explainer/Create Account visible during shell wait (fail-fast diagnostic)',
        );
      } catch {
        // ignore diagnostic failures
      }
      throw new Error('E2E_AUTH_STUCK_SIGNUP');
    }
    if (role !== 'modelLinked') {
      const legalBlocking = await legalAcceptanceGateLocator(page).first().isVisible().catch(() => false);
      if (legalBlocking) {
        try {
          await dismissLegalAcceptanceIfPresent(page, {
            requireAgencyRightsCheckbox: b2bRequiresAgencyRightsCheckbox(role),
          });
        } catch {
          // mid-mount / animation; keep polling within deadline
        }
        await page.waitForTimeout(320);
        continue;
      }
    }
    if (await shellVisible()) {
      if (role === 'modelLinked') {
        const legalNow = await legalAcceptanceGateLocator(page).first().isVisible().catch(() => false);
        if (legalNow) return;
        const homeNow = await page
          .getByText(/^Home$/)
          .or(page.getByRole('tab', { name: /^Home$/i }))
          .first()
          .isVisible()
          .catch(() => false);
        if (homeNow) {
          modelHomeTicks += 1;
          if (modelHomeTicks >= 2) return;
        } else {
          modelHomeTicks = 0;
        }
      } else {
        return;
      }
    } else {
      modelHomeTicks = 0;
    }
    await page.waitForTimeout(280);
  }
  try {
    const diag = await collectAuthUiDiagnostics(page);
    appendAuthFailureSummaryMd(role, diag, 'E2E_AUTH_SHELL_TIMEOUT — no workspace signals before deadline');
  } catch {
    // ignore
  }
  throw new Error('E2E_AUTH_SHELL_TIMEOUT');
}

/**
 * Puts hosted AuthScreen into the credential **Login** branch (not Sign up). For use from specs that
 * do not call `signInAs` (e.g. invalid-credentials probe).
 */
export async function prepareAuthScreenForCredentialLogin(page: Page): Promise<void> {
  await exitForgotPasswordIfNeeded(page);
  await forcePlainAuthTabsToLogin(page);
  await ensureLoginMode(page);
  await assertReadyToCredentialSignIn(page);
}

/** Submits the auth form using the same resilient control resolution as `signInAs`. */
export async function submitAuthScreen(page: Page): Promise<boolean> {
  return tryClickAuthSubmit(page);
}

export type SignInAsOptions = {
  /** Single navigation attempt + short shell cap — for `e2e:preflight` only. */
  preflight?: boolean;
  /** When set, workspace gate skips the test instead of running a doomed login. */
  testInfo?: TestInfo;
};

/**
 * Sign in via AuthScreen (Expo web). Tolerates minor placeholder / primary CTA copy drift (E2E-only).
 * Retries once with a full navigation if the first attempt does not reach the authenticated shell.
 */
export async function signInAs(page: Page, role: E2EAccountRole, options?: SignInAsOptions): Promise<void> {
  applyWorkspaceGateOrSkip(role, options?.testInfo);

  const email = emailForRole(role);
  const password = getTestPassword();
  if (!password) throw new Error(credentialHintForThrow());

  const preflight = options?.preflight === true;
  const maxAttempts = preflight ? 1 : 2;
  const legalShellMs = preflight ? PREFLIGHT_SHELL_MS : 40_000;
  const sessionProbeMs = preflight ? 8_000 : 12_000;
  const modelFollowupShellMs = preflight ? PREFLIGHT_SHELL_MS : 40_000;

  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let submitButtonClicked = false;
    try {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('load').catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);

      const agencyLegalExtras = b2bRequiresAgencyRightsCheckbox(role);

      if (await legalAcceptanceGateLocator(page).first().isVisible().catch(() => false)) {
        await dismissLegalAcceptanceIfPresent(page, { requireAgencyRightsCheckbox: agencyLegalExtras });
        await assertAuthenticatedShell(page, role, legalShellMs);
        if (role === 'modelLinked') {
          await dismissLegalAcceptanceIfPresent(page, { requireAgencyRightsCheckbox: false });
          await assertAuthenticatedShell(page, role, modelFollowupShellMs);
        }
        return;
      }

      if (!(await emailFieldLocator(page).isVisible().catch(() => false))) {
        try {
          if (
            (role === 'agencyOwner' ||
              role === 'booker' ||
              role === 'clientOwner' ||
              role === 'clientTeam') &&
            (await legalAcceptanceGateLocator(page).first().isVisible().catch(() => false))
          ) {
            await dismissLegalAcceptanceIfPresent(page, { requireAgencyRightsCheckbox: agencyLegalExtras });
          }
          const resumeShellMs =
            role === 'modelLinked' ? sessionProbeMs : preflight ? sessionProbeMs : AUTH_SHELL_MS;
          await assertAuthenticatedShell(page, role, resumeShellMs);
          if (role === 'modelLinked') {
            await dismissLegalAcceptanceIfPresent(page, { requireAgencyRightsCheckbox: false });
            await assertAuthenticatedShell(page, role, modelFollowupShellMs);
          }
          return;
        } catch {
          /* credential AuthScreen not ready yet */
        }
      }

      await forcePlainAuthTabsToLogin(page);

      await ensureLoginMode(page);
      await assertReadyToCredentialSignIn(page);
      /** Second pass: RN Web hydration occasionally leaves tabs on Sign up while negatives pass. */
      await ensureLoginMode(page);
      await assertReadyToCredentialSignIn(page);

      /** Final tab nudge immediately before credentials — reduces no-op submits on the wrong branch. */
      await loginModeTabLocator(page).first().click({ force: true });
      await waitForCredentialLoginBranchVisible(page, preflight ? 6_000 : 10_000);
      await assertReadyToCredentialSignIn(page);

      const emailField = emailFieldLocator(page);
      const passwordField = passwordFieldLocator(page);

      await expect(emailField).toBeVisible({ timeout: AUTH_FORM_MS });
      await expect(passwordField).toBeVisible({ timeout: AUTH_FORM_MS });

      await emailField.fill(email);
      await passwordField.fill(password);

      await recoverLoginBranchAndRefillIfNeeded(page, email, password);

      submitButtonClicked = await tryClickAuthSubmit(page);
      if (!submitButtonClicked) {
        await passwordField.press('Enter').catch(() => undefined);
      }

      /**
       * Hosted RN Web: AuthScreen can remount to default Sign up after a no-op submit.
       * Bounded check: if “Create Account” stays visible, re-enter login branch and submit once more.
       */
      try {
        await expect
          .poll(
            async () => {
              const org = await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count();
              const ca = await page.getByText(/^Create Account$/i).filter({ visible: true }).count();
              const expl = await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count();
              const dn = await page.getByPlaceholder(/^Display name$/i).filter({ visible: true }).count();
              const rules = await page.getByText(/Min\. 10 characters/u).filter({ visible: true }).count();
              return org === 0 && ca === 0 && expl === 0 && dn === 0 && rules === 0;
            },
            { timeout: preflight ? 4_000 : 8_000 },
          )
          .toBe(true);
      } catch {
        await recoverLoginBranchAndRefillIfNeeded(page, email, password);
        submitButtonClicked = await tryClickAuthSubmit(page);
        if (!submitButtonClicked) {
          await passwordFieldLocator(page).press('Enter').catch(() => undefined);
        }
      }

      const orgPost = await page.getByPlaceholder(/Organization name/i).filter({ visible: true }).count();
      const caPost = await page.getByText(/^Create Account$/i).filter({ visible: true }).count();
      const explPost = await page.getByText(SIGNUP_EXPLAINER_PATTERN).filter({ visible: true }).count();
      const rulesPost = await page.getByText(/Min\. 10 characters/u).filter({ visible: true }).count();
      if (orgPost > 0 || caPost > 0 || explPost > 0 || rulesPost > 0) {
        throw new Error(
          'E2E_AUTH_STUCK_SIGNUP: Sign-up chrome still visible after submit (explainer / Create Account / Organization name / password rules). See Playwright attachment failure-summary.md after final attempt.',
        );
      }

      const shellAfterSubmit = preflight
        ? PREFLIGHT_SHELL_MS
        : attempt === 0
          ? 28_000
          : AUTH_SHELL_MS;
      await assertAuthenticatedShell(page, role, shellAfterSubmit);
      if (role === 'modelLinked') {
        await dismissLegalAcceptanceIfPresent(page, { requireAgencyRightsCheckbox: false });
        await assertAuthenticatedShell(page, role, modelFollowupShellMs);
      }
      return;
    } catch (err) {
      lastErr = err;
      const stuckSignup = err instanceof Error && /E2E_AUTH_STUCK_SIGNUP/i.test(err.message);
      if (
        stuckSignup &&
        (role === 'agencyOwner' || role === 'booker' || role === 'clientOwner' || role === 'clientTeam')
      ) {
        recordRuntimeB2bStuckSignup(
          role,
          err instanceof Error ? err.message.slice(0, 240) : 'E2E_AUTH_STUCK_SIGNUP',
        );
      }
      if (attempt === maxAttempts - 1) {
        const diag = await collectAuthUiDiagnostics(page);
        const shellTimeout = err instanceof Error && /E2E_AUTH_SHELL_TIMEOUT/i.test(err.message);
        const reason = stuckSignup
          ? 'Sign-up chrome became (or stayed) visible during shell wait, or immediately after submit — B2B login did not reach workspace (credentials / hosted user / submit).'
          : shellTimeout
            ? 'No authenticated workspace signals before deadline (Dashboard / Logout / role tab / Home / Terms) and no sign-up relapse detected — paywall/blocking screen / slow hydration / missing mapping.'
            : submitButtonClicked
              ? 'Authenticated shell (Dashboard / Logout / role workspace tab such as My Models or Discover / Home / Terms gate) not visible in time after submit (after full retry). Likely wrong branch, wrong credentials for hosted target, paywall block, or auth error message not yet mapped in harness.'
              : 'No visible enabled auth submit matched known patterns; Enter fallback used; shell still not visible after retry.';
        appendAuthFailureSummaryMd(role, diag, reason);
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function credentialHintForThrow(): string {
  return 'Missing PLAYWRIGHT_TEST_PASSWORD or E2E_SEED_USER_PASSWORD — copy .env.e2e.example to .env.e2e';
}

/** After hosted/web logout the SPA may land on Sign up first; stabilize credential-login branch (harness-only). */
export async function signOutViaUi(page: Page): Promise<void> {
  const emailVisibleBudget = { timeout: 45_000 };

  const byText = page.getByText(/^Logout$/i).filter({ visible: true }).first();
  const asButton = page.getByRole('button', { name: /logout|sign out/i }).filter({ visible: true }).first();

  if (await byText.isVisible().catch(() => false)) {
    await byText.click();
  } else if (await asButton.isVisible().catch(() => false)) {
    await asButton.click();
  } else {
    throw new Error('signOutViaUi: no visible Logout control');
  }

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  try {
    await expect(emailFieldLocator(page)).toBeVisible(emailVisibleBudget);
  } catch {
    await prepareAuthScreenForCredentialLogin(page);
    await expect(emailFieldLocator(page)).toBeVisible(emailVisibleBudget);
  }
}
