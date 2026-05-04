/**
 * Regression guards for high-churn SECURITY DEFINER RPCs: scan repo migrations/
 * like agencyRemoveModelSoftEndMigration.test.ts so new CREATE OR REPLACE drafts
 * cannot silently drop hardening markers.
 *
 * Live spot-check: scripts/verify-live-hot-rpc-drift.sh
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');

/* ─── claim_model_by_token ─── */

/** Historical only — MUST NOT exhibit cross-account guard; frozen chain. */
const LEGACY_CLAIM_MODEL_BY_TOKEN_NO_CROSS_GUARD = new Set([
  '20260408_invite_claim_idempotent_finalization.sql',
  '20260413_fix_c_model_claim_tokens.sql',
  '20260520_claim_model_by_token_set_active.sql',
  '20260611_fix_model_claim_token_hash_and_role.sql',
]);

function definesClaimModelByToken(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.claim_model_by_token\s*\(/is.test(sql);
}

function hasCrossAccountClaimGuard(sql: string): boolean {
  return /model_already_claimed_by_other_user/i.test(sql);
}

/* ─── delete_option_request_full ─── */

const LEGACY_DELETE_OPTION_REQUEST_FULL_NO_B2B_MESSAGES = new Set([
  '20260546_delete_option_request_full.sql',
]);

function definesDeleteOptionRequestFull(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.delete_option_request_full\s*\(/is.test(sql);
}

function hasB2BMessagesDeletedMarker(sql: string): boolean {
  return /jsonb_set\s*\(/is.test(sql) && /UPDATE\s+public\.messages/is.test(sql);
}

/* ─── generate_model_claim_token ─── */

/** Migrations allowed to literally call encode(gen_random_bytes(...)) — pre-20261209 history. */
const LEGACY_GENERATE_MODEL_CLAIM_ENCODE_GEN_RANDOM_BYTES = new Set([
  '20260413_fix_c_model_claim_tokens.sql',
  '20260423_generate_model_claim_token_scope_by_model_agency.sql',
  '20260424_generate_model_claim_token_organization_param.sql',
  '20260427_fix_agency_guard_no_owner_user_id.sql',
  '20261023_generate_model_claim_token_co_agency_branch.sql',
  '20261207_fix_generate_model_claim_token_no_agencies_owner_user_id.sql',
]);

function definesGenerateModelClaimToken(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.generate_model_claim_token\s*\(/is.test(sql);
}

function usesEncodeGenRandomBytes(sql: string): boolean {
  return /encode\s*\(\s*gen_random_bytes\s*\(/is.test(sql);
}

describe('claim_model_by_token migration chain (cross-account guard)', () => {
  const canonical = '20261205_claim_model_by_token_user_id_guard.sql';

  it('canonical migration contains guard + SECURITY DEFINER basics', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');
    expect(hasCrossAccountClaimGuard(sql)).toBe(true);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_model_by_token/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET row_security\s+TO\s+off/i);
    expect(/\bUPDATE\s+public\.models[\s\S]{0,2400}?user_id\s+IS\s+NULL/is.test(sql)).toBe(true);
  });

  it('every migration REDEFINING claim_model_by_token is legacy or carries cross-account guard', () => {
    const migrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const definers: string[] = [];
    const violations: string[] = [];

    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      if (!definesClaimModelByToken(sql)) continue;
      definers.push(f);

      if (LEGACY_CLAIM_MODEL_BY_TOKEN_NO_CROSS_GUARD.has(f)) {
        expect(hasCrossAccountClaimGuard(sql)).toBe(false);
        continue;
      }
      if (!hasCrossAccountClaimGuard(sql)) violations.push(f);
    }

    expect(violations).toEqual([]);
    expect(definers).toContain(canonical);
    const last = definers[definers.length - 1];
    expect(last).toBe(canonical);
    expect(
      hasCrossAccountClaimGuard(fs.readFileSync(path.join(MIGRATIONS_DIR, last), 'utf8')),
    ).toBe(true);
  });
});

describe('delete_option_request_full migration chain (B2B messages stale cleanup)', () => {
  const canonical = '20260820_delete_option_request_full_update_b2b_messages.sql';

  it('canonical migration touches messages + jsonb deleted marker', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');
    expect(hasB2BMessagesDeletedMarker(sql)).toBe(true);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_option_request_full/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET row_security\s+TO\s+'off'/i);
  });

  it('every migration REDEFINING delete_option_request_full is legacy or has B2B UPDATE', () => {
    const migrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const definers: string[] = [];
    const violations: string[] = [];

    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      if (!definesDeleteOptionRequestFull(sql)) continue;
      definers.push(f);

      if (LEGACY_DELETE_OPTION_REQUEST_FULL_NO_B2B_MESSAGES.has(f)) {
        expect(hasB2BMessagesDeletedMarker(sql)).toBe(false);
        continue;
      }
      if (!hasB2BMessagesDeletedMarker(sql)) violations.push(f);
    }

    expect(violations).toEqual([]);
    expect(definers).toContain(canonical);
    const last = definers[definers.length - 1];
    expect(last).toBe(canonical);
  });
});

describe('generate_model_claim_token migration chain (no pgcrypto encode(gen_random_bytes))', () => {
  const canonical = '20261209_generate_model_claim_token_no_pgcrypto.sql';

  it('canonical migration avoids encode(gen_random_bytes) and asserts built-in hashing', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');
    expect(usesEncodeGenRandomBytes(sql)).toBe(false);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.generate_model_claim_token/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET row_security\s+TO\s+off/i);
    expect(sql).toMatch(/sha256\s*\(/i);
    expect(sql).toMatch(/ASSERT\s+v_def\s+NOT\s+ILIKE\s+'%gen_random_bytes%'/i);
  });

  it('every migration REDEFINING generate_model_claim_token is legacy or avoids encode(gen_random_bytes)', () => {
    const migrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const definers: string[] = [];
    const violations: string[] = [];

    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      if (!definesGenerateModelClaimToken(sql)) continue;
      definers.push(f);

      if (LEGACY_GENERATE_MODEL_CLAIM_ENCODE_GEN_RANDOM_BYTES.has(f)) {
        expect(usesEncodeGenRandomBytes(sql)).toBe(true);
        continue;
      }
      if (usesEncodeGenRandomBytes(sql)) violations.push(f);
    }

    expect(violations).toEqual([]);
    expect(definers).toContain(canonical);
    const last = definers[definers.length - 1];
    expect(last).toBe(canonical);
    expect(usesEncodeGenRandomBytes(fs.readFileSync(path.join(MIGRATIONS_DIR, last), 'utf8'))).toBe(
      false,
    );
  });
});
