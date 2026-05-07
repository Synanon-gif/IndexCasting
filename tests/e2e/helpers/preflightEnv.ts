import fs from 'node:fs';
import path from 'node:path';

import { getBaseUrl, loadSeedManifestIfAvailable, pathToE2eEnvFile } from './env';

export type PasswordEnvCheck = {
  dotenvE2ePresent: boolean;
  passwordConfigured: boolean;
  passwordVarsAligned: boolean;
  detail: string;
};

export function safeHostname(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Reads candidate Supabase project URL from env (never logs full URL values in reports). */
export function supabaseProjectHostFromEnv(): string | null {
  const keys = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'E2E_SUPABASE_URL',
  ];
  for (const k of keys) {
    const h = safeHostname(process.env[k]);
    if (h) return h;
  }
  return null;
}

export function checkPasswordEnvForPreflight(): PasswordEnvCheck {
  const dotenvE2ePresent = fs.existsSync(pathToE2eEnvFile());
  const p1 = process.env.PLAYWRIGHT_TEST_PASSWORD?.trim();
  const p2 = process.env.E2E_SEED_USER_PASSWORD?.trim();

  if (!p1 && !p2) {
    return {
      dotenvE2ePresent,
      passwordConfigured: false,
      passwordVarsAligned: false,
      detail: 'Neither PLAYWRIGHT_TEST_PASSWORD nor E2E_SEED_USER_PASSWORD is set',
    };
  }
  if (p1 && p2 && p1 !== p2) {
    return {
      dotenvE2ePresent,
      passwordConfigured: true,
      passwordVarsAligned: false,
      detail:
        'PLAYWRIGHT_TEST_PASSWORD and E2E_SEED_USER_PASSWORD both set but differ — use one canonical password',
    };
  }
  return {
    dotenvE2ePresent,
    passwordConfigured: true,
    passwordVarsAligned: true,
    detail:
      p1 && p2
        ? 'Both password vars set and equal (aligned)'
        : p1
          ? 'PLAYWRIGHT_TEST_PASSWORD set, E2E_SEED_USER_PASSWORD empty'
          : 'E2E_SEED_USER_PASSWORD set, PLAYWRIGHT_TEST_PASSWORD empty',
  };
}

export function manifestPathPreflight(): string {
  return path.join(process.cwd(), 'docs', 'e2e-seed-manifest.json');
}

export function manifestPresentForPreflight(): boolean {
  try {
    return fs.existsSync(manifestPathPreflight());
  } catch {
    return false;
  }
}

export function envParityWarningLine(): string | null {
  const manifest = loadSeedManifestIfAvailable();
  const manifestHost = manifest?.supabase_url_host?.trim();
  const envHost = supabaseProjectHostFromEnv();
  const baseHost = safeHostname(getBaseUrl());

  if (manifestHost && envHost && manifestHost !== envHost) {
    return `POSSIBLE ENV PARITY MISMATCH: manifest supabase_url_host (${manifestHost}) !== Supabase host from env (${envHost}).`;
  }

  if (baseHost?.includes('index-casting.com') && envHost && manifestHost && manifestHost !== envHost) {
    return `POSSIBLE ENV PARITY MISMATCH: hosted base ${baseHost} — manifest host (${manifestHost}) vs env Supabase host (${envHost}).`;
  }

  if (manifestHost && !envHost) {
    return `Manifest lists supabase_url_host=${manifestHost} but no Supabase URL host found in process env (EXPO_PUBLIC_SUPABASE_URL / SUPABASE_URL / …) — cannot cross-check.`;
  }

  return null;
}

export type PreflightStaticReportSection = {
  baseUrlHost: string | null;
  baseUrlClass: 'local' | 'lan-dev' | 'hosted';
  password: PasswordEnvCheck;
  manifestPresent: boolean;
  parityWarning: string | null;
};

export function classifyBaseUrlHost(): 'local' | 'lan-dev' | 'hosted' {
  const host = safeHostname(getBaseUrl());
  if (!host) return 'hosted';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'local';
  if (/^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host)) return 'lan-dev';
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return 'lan-dev';
  return 'hosted';
}

export function buildPreflightStaticSection(): PreflightStaticReportSection {
  return {
    baseUrlHost: safeHostname(getBaseUrl()),
    baseUrlClass: classifyBaseUrlHost(),
    password: checkPasswordEnvForPreflight(),
    manifestPresent: manifestPresentForPreflight(),
    parityWarning: envParityWarningLine(),
  };
}
