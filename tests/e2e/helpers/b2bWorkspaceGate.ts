import fs from 'node:fs';
import path from 'node:path';

import type { TestInfo } from '@playwright/test';

import type { E2EAccountRole } from './env';

const ARTIFACTS_DIR = path.join(process.cwd(), 'e2e-artifacts');

/** Written by `e2e:preflight` — consumed by P0 B2B tests to skip repeated doomed logins. */
export const PREFLIGHT_WORKSPACE_STATE_PATH = path.join(ARTIFACTS_DIR, 'preflight-workspace-state.json');

/** Written when `signInAs` hits `E2E_AUTH_STUCK_SIGNUP` for a B2B owner during a suite run. */
export const RUNTIME_B2B_BLOCK_PATH = path.join(ARTIFACTS_DIR, 'runtime-b2b-workspace-block.json');

export type PreflightRoleResult = {
  ok: boolean;
  errorCode?: string;
  suspectedCause?: PreflightSuspectedCause;
  notes?: string;
};

export type PreflightSuspectedCause =
  | 'wrong_password'
  | 'user_missing_in_supabase'
  | 'seed_db_mismatch'
  | 'legal_gate_stuck'
  | 'signup_mode_stuck'
  | 'selector_drift'
  | 'shell_timeout'
  | 'unknown';

export type PreflightWorkspaceStateV1 = {
  version: 1;
  generatedAt: string;
  baseUrlClass: string;
  /** Host only, e.g. www.index-casting.com */
  e2eBaseHost?: string | null;
  agency: PreflightRoleResult;
  client: PreflightRoleResult;
  model: PreflightRoleResult;
  env: {
    dotenvE2ePresent: boolean;
    passwordConfigured: boolean;
    passwordVarsAligned: boolean;
    manifestPresent: boolean;
    parityWarning?: string | null;
  };
};

export type RuntimeB2bBlockV1 = {
  version: 1;
  at: string;
  agencyBlocked?: boolean;
  clientBlocked?: boolean;
  reason?: string;
};

const BLOCKER_PREFIX =
  'BLOCKER: B2B auth/workspace gate — do not repeat slow login failures. Fix env/parity or run `npm run e2e:preflight`.';

export function shouldIgnorePreflightBlock(): boolean {
  return process.env.E2E_IGNORE_PREFLIGHT_BLOCK?.trim() === '1';
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function loadPreflightWorkspaceState(): PreflightWorkspaceStateV1 | null {
  const row = readJson<PreflightWorkspaceStateV1>(PREFLIGHT_WORKSPACE_STATE_PATH);
  if (!row || row.version !== 1) return null;
  return row;
}

export function loadRuntimeB2bBlock(): RuntimeB2bBlockV1 | null {
  const row = readJson<RuntimeB2bBlockV1>(RUNTIME_B2B_BLOCK_PATH);
  if (!row || row.version !== 1) return null;
  return row;
}

export function writePreflightWorkspaceState(state: PreflightWorkspaceStateV1): void {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(PREFLIGHT_WORKSPACE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Called from auth helper when B2B owner login fails with STUCK_SIGNUP (same Playwright worker / CI job). */
export function recordRuntimeB2bStuckSignup(role: E2EAccountRole, reason: string): void {
  if (role !== 'agencyOwner' && role !== 'booker' && role !== 'clientOwner' && role !== 'clientTeam') return;

  const prev = loadRuntimeB2bBlock() ?? { version: 1, at: new Date().toISOString() };
  const next: RuntimeB2bBlockV1 = {
    version: 1,
    at: new Date().toISOString(),
    agencyBlocked: prev.agencyBlocked,
    clientBlocked: prev.clientBlocked,
    reason: prev.reason ? `${prev.reason}; ${reason}` : reason,
  };
  if (role === 'agencyOwner' || role === 'booker') next.agencyBlocked = true;
  if (role === 'clientOwner' || role === 'clientTeam') next.clientBlocked = true;

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_B2B_BLOCK_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/** Call at start of `signInAs` when `testInfo` is available — skips test if gate active. */
export function applyWorkspaceGateOrSkip(role: E2EAccountRole, testInfo?: TestInfo): void {
  if (shouldIgnorePreflightBlock()) return;
  if (role === 'agencyOwner' || role === 'booker') {
    const m = skipReasonAgencyWorkspace();
    if (m) {
      if (testInfo) testInfo.skip(true, m);
      else throw new Error(m);
    }
    return;
  }
  if (role === 'clientOwner' || role === 'clientTeam') {
    const m = skipReasonClientWorkspace();
    if (m) {
      if (testInfo) testInfo.skip(true, m);
      else throw new Error(m);
    }
    return;
  }
  if (role === 'modelLinked') {
    const m = skipReasonModelWorkspace();
    if (m) {
      if (testInfo) testInfo.skip(true, m);
      else throw new Error(m);
    }
  }
}

function formatBlockDetail(kind: 'preflight' | 'runtime', detail: string): string {
  return `${BLOCKER_PREFIX} (${kind}: ${detail})`;
}

/** Agency / booker paths share the seeded agency owner workspace. */
export function skipReasonAgencyWorkspace(): string | undefined {
  if (shouldIgnorePreflightBlock()) return undefined;

  const rt = loadRuntimeB2bBlock();
  if (rt?.agencyBlocked) {
    return formatBlockDetail('runtime', rt.reason ?? 'agency STUCK_SIGNUP or shell failure in this run');
  }

  const pf = loadPreflightWorkspaceState();
  if (pf && !pf.agency.ok) {
    return formatBlockDetail(
      'preflight',
      pf.agency.errorCode ?? pf.agency.suspectedCause ?? 'agency workspace probe failed',
    );
  }

  return undefined;
}

export function skipReasonClientWorkspace(): string | undefined {
  if (shouldIgnorePreflightBlock()) return undefined;

  const rt = loadRuntimeB2bBlock();
  if (rt?.clientBlocked) {
    return formatBlockDetail('runtime', rt.reason ?? 'client STUCK_SIGNUP or shell failure in this run');
  }

  const pf = loadPreflightWorkspaceState();
  if (pf && !pf.client.ok) {
    return formatBlockDetail(
      'preflight',
      pf.client.errorCode ?? pf.client.suspectedCause ?? 'client workspace probe failed',
    );
  }

  return undefined;
}

/** Model is gated only by preflight (never by B2B runtime block). */
export function skipReasonModelWorkspace(): string | undefined {
  if (shouldIgnorePreflightBlock()) return undefined;
  const pf = loadPreflightWorkspaceState();
  if (pf && !pf.model.ok) {
    return `${BLOCKER_PREFIX} (preflight: ${pf.model.errorCode ?? pf.model.suspectedCause ?? 'model workspace probe failed'})`;
  }
  return undefined;
}
