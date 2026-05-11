#!/usr/bin/env node
/**
 * Static verification of e2eSafetyGuard.cjs (no secrets, no Playwright, no seeds).
 * Run: node scripts/e2e/verify-e2e-safety-guard.mjs
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const g = require('./e2eSafetyGuard.cjs');

function fail(msg) {
  console.error('[verify-e2e-safety-guard] FAIL:', msg);
  process.exit(2);
}

{
  const r = g.evaluatePlaywrightHarnessSafety('https://www.index-casting.com', {
    E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND',
  });
  if (r.ok) fail('expected playwright safety failure for prod host + seed latch');
}

{
  const r = g.evaluatePlaywrightHarnessSafety('https://www.index-casting.com', {});
  if (!r.ok) fail('expected ok for prod host without dangerous flags');
}

{
  const r = g.evaluatePlaywrightHarnessSafety('http://localhost:8081', {
    E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-not-secret',
  });
  if (!r.ok) fail('expected ok for localhost with dangerous flags');
}

{
  const r = g.evaluatePlaywrightHarnessSafety('https://staging-branch.index-casting.com', {
    E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND',
    E2E_SAFETY_ALLOWLIST_INDEX_CASTING_HOSTS: 'staging-branch.index-casting.com',
  });
  if (!r.ok) fail('expected allowlisted staging subdomain to pass');
}

{
  const r = g.evaluateSeedScriptSafety(
    'https://ispkfdqzjrfrilosoklu.supabase.co',
    'http://localhost:8081',
    { E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND' },
  );
  if (r.ok) fail('expected seed failure for known production Supabase ref');
}

{
  const r = g.evaluateSeedScriptSafety(
    'https://abc123.supabase.co',
    'https://www.index-casting.com',
    { E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND' },
  );
  if (r.ok) fail('expected seed failure for prod-like app host');
}

{
  const r = g.evaluateSeedScriptSafety('https://abc123.supabase.co', '', {
    E2E_ALLOW_SEED_ON_THIS_DATABASE: 'I_UNDERSTAND',
  });
  if (!r.ok) fail('expected seed ok when app URL unset and non-prod Supabase');
}

console.log('[verify-e2e-safety-guard] OK');
