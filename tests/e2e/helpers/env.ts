import fs from 'node:fs';
import path from 'node:path';

import type { APIRequestContext } from '@playwright/test';

export function getBaseUrl(): string {
  return (
    process.env.E2E_BASE_URL?.trim() ||
    process.env.PLAYWRIGHT_BASE_URL?.trim() ||
    'http://localhost:8081'
  );
}

/**
 * Active Playwright/seed env file basename relative to repo root.
 * Set in the shell or npm script only (not inside the file being loaded — chicken/egg).
 */
export function e2eEnvFileBasename(): string {
  const raw = (process.env.E2E_ENV_FILE || '').trim() || '.env.e2e';
  const abs = path.resolve(process.cwd(), raw);
  const root = path.resolve(process.cwd());
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    console.warn(
      `[e2e] E2E_ENV_FILE must resolve under repo root (got "${raw}"); falling back to .env.e2e`,
    );
    return '.env.e2e';
  }
  return raw;
}

export function pathToE2eEnvFile(): string {
  return path.join(process.cwd(), e2eEnvFileBasename());
}

export function isE2eEnvFilePresent(): boolean {
  try {
    return fs.existsSync(pathToE2eEnvFile());
  } catch {
    return false;
  }
}

export function getTestPassword(): string | undefined {
  const p =
    process.env.PLAYWRIGHT_TEST_PASSWORD?.trim() || process.env.E2E_SEED_USER_PASSWORD?.trim();
  return p || undefined;
}

export function hasAuthCredentials(): boolean {
  return !!getTestPassword();
}

/**
 * When true, `p0-option-lifecycle-mutations.spec.ts` may run multi-step negotiation writes.
 * Mutations advance shared seed rows — re-run `npm run seed:e2e` on an isolated DB after local runs.
 */
export function allowsOptionLifecycleMutations(): boolean {
  return process.env.E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS?.trim() === 'I_UNDERSTAND';
}

/** Same as `loadSeedManifestIfAvailable` — explicit name for test code. */
export function getSeededIds(): E2ESeedManifest | null {
  return loadSeedManifestIfAvailable();
}

/**
 * Warn when running Playwright against a hosted URL with password-based E2E accounts (never logs secrets).
 */
export function warnProductionE2EAccounts(baseUrl: string = getBaseUrl()): void {
  if (!isNonLocalBaseUrl(baseUrl) || !hasAuthCredentials()) return;
  console.warn(
    '[e2e] Running against production-like URL with E2E accounts only. Do not run seed scripts or mutation E2E against real production data.',
  );
  console.warn(
    '[e2e] Stateful chat / option-lifecycle tests require E2E_ALLOW_CHAT_WRITES and/or E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS; hosted/non-local-dev URLs also need E2E_ALLOW_HOSTED_WRITES — see .env.e2e.example.',
  );
}

/** Clear, actionable skip reason — never implies credentials exist when they do not. */
export function credentialGapMessage(): string {
  const parts = [
    'Missing PLAYWRIGHT_TEST_PASSWORD or E2E_SEED_USER_PASSWORD (same value as E2E_SEED_USER_PASSWORD after `npm run seed:e2e`).',
  ];
  if (!isE2eEnvFilePresent()) {
    parts.push(
      `No E2E env file at ${pathToE2eEnvFile()} — copy .env.e2e.example or a profile from .env.e2e.*.example (set E2E_ENV_FILE for non-default names).`,
    );
  } else {
    parts.push(
      'E2E env file present but password env vars empty — set PLAYWRIGHT_TEST_PASSWORD or E2E_SEED_USER_PASSWORD inside it.',
    );
  }
  return parts.join(' ');
}

export type E2EAccountRole = 'agencyOwner' | 'clientOwner' | 'modelLinked' | 'booker' | 'clientTeam';

const DEFAULT_EMAILS: Record<E2EAccountRole, string> = {
  agencyOwner: 'e2e-agency-owner@index-casting.test',
  booker: 'e2e-booker@index-casting.test',
  clientOwner: 'e2e-client-owner@index-casting.test',
  clientTeam: 'e2e-client-team@index-casting.test',
  modelLinked: 'e2e-model-linked@index-casting.test',
};

export function emailForRole(role: E2EAccountRole): string {
  switch (role) {
    case 'agencyOwner':
      return process.env.E2E_AGENCY_OWNER_EMAIL?.trim() || DEFAULT_EMAILS.agencyOwner;
    case 'booker':
      return process.env.E2E_BOOKER_EMAIL?.trim() || DEFAULT_EMAILS.booker;
    case 'clientOwner':
      return process.env.E2E_CLIENT_OWNER_EMAIL?.trim() || DEFAULT_EMAILS.clientOwner;
    case 'clientTeam':
      return process.env.E2E_CLIENT_TEAM_EMAIL?.trim() || DEFAULT_EMAILS.clientTeam;
    case 'modelLinked':
      return process.env.E2E_MODEL_LINKED_EMAIL?.trim() || DEFAULT_EMAILS.modelLinked;
    default:
      return DEFAULT_EMAILS[role];
  }
}

/** Typed subset of `docs/e2e-seed-manifest.json` (written by `npm run seed:e2e`). */
export type E2ESeedManifest = {
  generated_at?: string;
  supabase_url_host?: string;
  primary_agency_id?: string;
  primary_agency_org_id?: string;
  primary_client_org_id?: string;
  linked_model_id?: string;
  b2b_conversation_id?: string | null;
  first_client_project_id?: string | null;
  option_requests?: {
    option_id?: string | null;
    casting_id?: string | null;
    /** Seeded option with `model_account_linked: false` (no app account). */
    unlinked_option_id?: string | null;
  };
  /** Written by `seed-e2e-world.mjs` — deterministic `job_description` strings for list matchers. */
  option_request_labels?: {
    linked_job_description?: string;
    casting_job_description?: string;
    unlinked_job_description?: string;
  };
  unlinked_model_id?: string | null;
  model_booking_deeplink_param?: string | null;
  guest_link_model_sample?: number;
  user_ids?: Record<string, string>;
};

/**
 * Optional manifest from seed — gitignored. Returns null if missing or invalid.
 */
export function loadSeedManifestIfAvailable(): E2ESeedManifest | null {
  try {
    const manifestPath = path.join(process.cwd(), 'docs', 'e2e-seed-manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    return raw as E2ESeedManifest;
  } catch {
    return null;
  }
}

/** @deprecated use loadSeedManifestIfAvailable */
export function tryLoadSeedManifest(): Record<string, unknown> | null {
  return loadSeedManifestIfAvailable() as Record<string, unknown> | null;
}

export function seededPublicAgencySlug(): string {
  return process.env.E2E_PUBLIC_AGENCY_SLUG?.trim() || 'playwright-e2e-northwind';
}

export function seededPublicClientSlug(): string {
  return process.env.E2E_PUBLIC_CLIENT_SLUG?.trim() || 'playwright-e2e-horizon';
}

function hostnameOfBaseUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for typical production / staging hosts (not localhost). */
export function isNonLocalBaseUrl(url: string = getBaseUrl()): boolean {
  const host = hostnameOfBaseUrl(url);
  if (!host) return false;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
}

function isPrivateLanIPv4Host(host: string): boolean {
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * Loopback or typical Expo LAN (RFC1918). Write tests here need kind-specific gates only
 * (E2E_ALLOW_CHAT_WRITES / E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS), not E2E_ALLOW_HOSTED_WRITES.
 */
export function isClearlyLocalOrLanDevBaseUrl(url: string = getBaseUrl()): boolean {
  const host = hostnameOfBaseUrl(url);
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  if (isPrivateLanIPv4Host(host)) return true;
  return false;
}

/**
 * Hosted / remote: not localhost, not loopback, not RFC1918 LAN.
 * Examples: https://www.index-casting.com, Vercel previews, staging on public DNS.
 * Stateful E2E writes against these URLs additionally require E2E_ALLOW_HOSTED_WRITES.
 */
export function isHostedProductionLikeBaseUrl(url: string = getBaseUrl()): boolean {
  return !isClearlyLocalOrLanDevBaseUrl(url);
}

export function allowsChatWrites(): boolean {
  return process.env.E2E_ALLOW_CHAT_WRITES?.trim() === 'I_UNDERSTAND';
}

/**
 * Explicit ack for running Playwright write tests against hosted (non-local-dev) base URLs.
 */
export function allowsHostedWrites(): boolean {
  return process.env.E2E_ALLOW_HOSTED_WRITES?.trim() === 'I_UNDERSTAND_HOSTED_WRITE_RISK';
}

export type E2EWriteKind = 'chat' | 'option_lifecycle';

export function isWriteTestAllowed(kind: E2EWriteKind): boolean {
  if (kind === 'chat') {
    if (!allowsChatWrites()) return false;
  } else {
    if (!allowsOptionLifecycleMutations()) return false;
  }
  if (isHostedProductionLikeBaseUrl() && !allowsHostedWrites()) return false;
  return true;
}

/** Human-readable missing gates (for skip messages and failure-summary). */
export function writeGateBlockedDetail(kind: E2EWriteKind): string {
  const parts: string[] = [];
  if (kind === 'chat' && !allowsChatWrites()) {
    parts.push('missing E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND');
  }
  if (kind === 'option_lifecycle' && !allowsOptionLifecycleMutations()) {
    parts.push('missing E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND');
  }
  if (isHostedProductionLikeBaseUrl() && !allowsHostedWrites()) {
    parts.push(
      'missing E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK for hosted/non-local-dev base URL',
    );
  }
  return parts.join('; ') || 'n/a';
}

export function chatWriteGateSkipMessage(): string {
  return [
    'BLOCKER: stateful chat tests blocked by E2E write gates.',
    writeGateBlockedDetail('chat') || '(see env vars below)',
    'Set E2E_ALLOW_CHAT_WRITES=I_UNDERSTAND.',
    'On hosted/non-local-dev base URLs (e.g. public staging) also set E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK.',
    'Use only isolated disposable E2E data.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function optionLifecycleWriteGateSkipMessage(): string {
  return [
    'BLOCKER: option lifecycle mutation tests blocked by E2E write gates.',
    writeGateBlockedDetail('option_lifecycle') || '(see env vars below)',
    'Set E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS=I_UNDERSTAND.',
    'On hosted/non-local-dev base URLs also set E2E_ALLOW_HOSTED_WRITES=I_UNDERSTAND_HOSTED_WRITE_RISK.',
    'Advances shared seeded rows — re-run npm run seed:e2e on an isolated DB after this test.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** For failure-summary: local | lan-dev | hosted */
export function classifyBaseUrlForDiagnostics(): 'local' | 'lan-dev' | 'hosted' {
  const url = getBaseUrl();
  const host = hostnameOfBaseUrl(url);
  if (!host) return 'hosted';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'local';
  if (isPrivateLanIPv4Host(host)) return 'lan-dev';
  return 'hosted';
}

/** Domain slice from default agency owner email — never log full address in diagnostics. */
export function defaultSeedEmailDomain(): string {
  const e = emailForRole('agencyOwner');
  const i = e.lastIndexOf('@');
  return i >= 0 ? e.slice(i + 1) : 'unknown';
}

/**
 * Warn when combining hosted app URL with dangerous local secrets (never logs secret values).
 */
export function logE2EEnvWarnings(baseUrl: string = getBaseUrl()): void {
  const host = hostnameOfBaseUrl(baseUrl);
  if (!host) {
    console.warn(`[e2e] E2E_BASE_URL / baseURL is not a valid URL: ${baseUrl.slice(0, 120)}`);
    return;
  }

  if (
    isNonLocalBaseUrl(baseUrl) &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.E2E_ALLOW_SEED_ON_THIS_DATABASE?.trim() === 'I_UNDERSTAND')
  ) {
    console.warn(
      `[e2e] WARNING: Non-local base URL (${host}) with seed/service-role related env set. Confirm you are NOT targeting production with destructive seed credentials.`,
    );
  }

  if (host.includes('index-casting.com') && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.warn(
      '[e2e] WARNING: index-casting.com host with SUPABASE_SERVICE_ROLE_KEY in environment — verify this is intentional (staging only).',
    );
  }
}

/**
 * GET base URL; throws if status >= 500 or connection fails — use from a test with request fixture.
 */
export async function assertBaseUrlReachable(
  request: APIRequestContext,
  baseUrl: string = getBaseUrl(),
): Promise<void> {
  const root = `${baseUrl.replace(/\/$/, '')}/`;
  const res = await request.get(root);
  if (res.status() >= 500) {
    throw new Error(`Base URL ${root} returned HTTP ${res.status()}`);
  }
}
