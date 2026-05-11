'use strict';

/**
 * E2E harness safety — fail-closed guard for Playwright global setup and seed script.
 * No secrets logged; only host names and flag names.
 *
 * Staging subdomains on index-casting.com may be exempt via:
 *   E2E_SAFETY_ALLOWLIST_INDEX_CASTING_HOSTS=host1.example.com,host2.example.com
 * (comma-separated, full hostnames, lowercase in practice)
 */

const KNOWN_PRODUCTION_SUPABASE_HOST = 'ispkfdqzjrfrilosoklu.supabase.co';

/**
 * @param {string | undefined | null} urlOrHost
 * @returns {string | null}
 */
function normalizeHost(urlOrHost) {
  if (!urlOrHost || typeof urlOrHost !== 'string') return null;
  const s = urlOrHost.trim();
  if (!s) return null;
  try {
    if (s.includes('://')) return new URL(s).hostname.toLowerCase();
    const first = s.replace(/^\/{2,}/, '').split('/')[0];
    return first ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>}
 */
function parseIndexCastingHostAllowlist(env) {
  const e = env || process.env;
  const raw = e.E2E_SAFETY_ALLOWLIST_INDEX_CASTING_HOSTS?.trim() || '';
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Production-like IndexCasting app hosts — block seed/write/service-role combos.
 * Subdomains of index-casting.com are included unless allowlisted.
 *
 * @param {string | null} hostname
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isProductionLikeIndexCastingAppHost(hostname, env) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  const allow = parseIndexCastingHostAllowlist(env);
  if (allow.has(h)) return false;
  if (h === 'index-casting.com' || h === 'www.index-casting.com' || h === 'web.index-casting.com') {
    return true;
  }
  if (h.endsWith('.index-casting.com')) return true;
  return false;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function dangerousHarnessEnvSignals(env) {
  const e = env || process.env;
  /** @type {string[]} */
  const flags = [];
  if (e.E2E_ALLOW_SEED_ON_THIS_DATABASE?.trim() === 'I_UNDERSTAND') {
    flags.push('E2E_ALLOW_SEED_ON_THIS_DATABASE');
  }
  if (e.E2E_ALLOW_HOSTED_WRITES?.trim() === 'I_UNDERSTAND_HOSTED_WRITE_RISK') {
    flags.push('E2E_ALLOW_HOSTED_WRITES');
  }
  if (e.E2E_ALLOW_CHAT_WRITES?.trim() === 'I_UNDERSTAND') {
    flags.push('E2E_ALLOW_CHAT_WRITES');
  }
  if (e.E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS?.trim() === 'I_UNDERSTAND') {
    flags.push('E2E_ALLOW_OPTION_LIFECYCLE_MUTATIONS');
  }
  if (e.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    flags.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  return flags;
}

/**
 * @param {string} baseUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean; lines: string[] }}
 */
function evaluatePlaywrightHarnessSafety(baseUrl, env) {
  const host = normalizeHost(baseUrl);
  const prodLike = !!(host && isProductionLikeIndexCastingAppHost(host, env));
  const flags = dangerousHarnessEnvSignals(env);
  if (prodLike && flags.length > 0) {
    const lines = [
      '[e2e-safety] FATAL: Production-like IndexCasting app host with dangerous E2E env signals.',
      `  host_class: index-casting-production-like`,
      `  base_url_host: ${host}`,
      `  active_signals: ${flags.join(', ')}`,
      '  Fix: use a staging/branch E2E_BASE_URL with disposable data, or use a production-readonly .env.e2e',
      '       without seed latch, service role, or write-gate env vars (see .env.e2e.example).',
      '  Optional: exempt a staging hostname with',
      '       E2E_SAFETY_ALLOWLIST_INDEX_CASTING_HOSTS=staging.example.index-casting.com',
      '    (comma-separated full hostnames only).',
    ];
    return { ok: false, lines };
  }
  return { ok: true, lines: [] };
}

/**
 * @param {string} baseUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
function assertPlaywrightHarnessSafe(baseUrl, env) {
  const { ok, lines } = evaluatePlaywrightHarnessSafety(baseUrl, env || process.env);
  if (!ok) {
    console.error(lines.join('\n'));
    process.exit(1);
  }
}

/**
 * @param {string | undefined | null} supabaseUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function supabaseHostIsKnownProductionProject(supabaseUrl, env) {
  const h = normalizeHost(supabaseUrl);
  if (!h) return false;
  return h === KNOWN_PRODUCTION_SUPABASE_HOST.toLowerCase();
}

/**
 * Seed hard-block: latch + (known prod Supabase project OR production-like app URL).
 *
 * @param {string} supabaseUrl
 * @param {string} [e2eAppBaseUrl] E2E_BASE_URL or PLAYWRIGHT_BASE_URL hint
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean; lines: string[] }}
 */
function evaluateSeedScriptSafety(supabaseUrl, e2eAppBaseUrl, env) {
  const e = env || process.env;
  if (e.E2E_ALLOW_SEED_ON_THIS_DATABASE?.trim() !== 'I_UNDERSTAND') {
    return { ok: true, lines: [] };
  }
  /** @type {string[]} */
  const lines = [];

  if (supabaseHostIsKnownProductionProject(supabaseUrl, e)) {
    lines.push(
      '[e2e-safety] FATAL: E2E_ALLOW_SEED_ON_THIS_DATABASE is set but EXPO_PUBLIC_SUPABASE_URL targets the known production Supabase project.',
      `  host_class: known_production_supabase_ref`,
      `  supabase_host: ${normalizeHost(supabaseUrl) || '(unparsed)'}`,
      '  Fix: point EXPO_PUBLIC_SUPABASE_URL at an isolated staging Supabase project and unset the seed latch until then.',
    );
    return { ok: false, lines };
  }

  const appHint = e2eAppBaseUrl?.trim() || e.E2E_BASE_URL?.trim() || e.PLAYWRIGHT_BASE_URL?.trim() || '';
  const appHost = normalizeHost(appHint);
  if (appHost && isProductionLikeIndexCastingAppHost(appHost, e)) {
    lines.push(
      '[e2e-safety] FATAL: Seed latch active while E2E_BASE_URL / PLAYWRIGHT_BASE_URL is a production-like IndexCasting app host.',
      `  host_class: index-casting-production-like`,
      `  app_host: ${appHost}`,
      '  Fix: run seed:e2e only when the app URL is staging/branch/Vercel, or unset E2E_ALLOW_SEED_ON_THIS_DATABASE for production-readonly work.',
      '  Optional: exempt a staging hostname with E2E_SAFETY_ALLOWLIST_INDEX_CASTING_HOSTS=...',
    );
    return { ok: false, lines };
  }

  return { ok: true, lines: [] };
}

/**
 * @param {string} supabaseUrl
 * @param {string} [e2eAppBaseUrl]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
function assertSeedScriptSafe(supabaseUrl, e2eAppBaseUrl, env) {
  const { ok, lines } = evaluateSeedScriptSafety(supabaseUrl, e2eAppBaseUrl, env || process.env);
  if (!ok) {
    console.error(lines.join('\n'));
    process.exit(1);
  }
}

module.exports = {
  KNOWN_PRODUCTION_SUPABASE_HOST,
  normalizeHost,
  isProductionLikeIndexCastingAppHost,
  dangerousHarnessEnvSignals,
  evaluatePlaywrightHarnessSafety,
  assertPlaywrightHarnessSafe,
  supabaseHostIsKnownProductionProject,
  evaluateSeedScriptSafety,
  assertSeedScriptSafe,
};
