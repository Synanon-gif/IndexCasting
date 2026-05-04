/**
 * Regression guard: agency_remove_model must NEVER write NULL to models.agency_id
 * (live NOT NULL → 23502 / PostgREST 400).
 *
 * Scans ALL supabase/migrations/*.sql for CREATE agency_remove_model; legacy filenames
 * with historical NULL branches are explicitly allowlisted frozen history only.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');

/** Historical migrations only — do not reuse their NULL-body pattern in new SQL. */
const LEGACY_AGENCY_REMOVE_MODEL_NULL_BODY = new Set([
  '20260831_agency_remove_model_hardening.sql',
  '20260902_agency_remove_model_idempotent_no_mat.sql',
  '20260905_b_end_representation_recruiting_application_sync.sql',
  '20260916_agency_remove_model_application_sync_warning.sql',
]);

function definesAgencyRemoveModel(sql: string): boolean {
  return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.agency_remove_model\s*\(/is.test(sql);
}

function assignsAgencyIdNull(sql: string): boolean {
  return /\bagency_id\b\s*=\s*null\b/is.test(sql);
}

describe('agency_remove_model migration policy (soft-end, no agency_id NULL)', () => {
  const canonical = '20261305_fix_agency_remove_model_soft_end.sql';

  it('canonical migration passes required safety markers', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');
    expect(assignsAgencyIdNull(sql)).toBe(false);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_remove_model/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET row_security TO off/i);
  });

  it('every migrations SQL that REDEFINES agency_remove_model satisfies policy', () => {
    const migrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const definers: string[] = [];
    const violations: string[] = [];

    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      if (!definesAgencyRemoveModel(sql)) continue;
      definers.push(f);

      if (LEGACY_AGENCY_REMOVE_MODEL_NULL_BODY.has(f)) {
        expect(assignsAgencyIdNull(sql)).toBe(true);
        continue;
      }

      // Any non-frozen RPC definition must never assign NULL to agency_id.
      if (assignsAgencyIdNull(sql)) {
        violations.push(f);
      }
    }

    expect(violations).toEqual([]);
    expect(definers.length).toBeGreaterThanOrEqual(1);
    expect(definers).toContain(canonical);

    const lastDefiner = definers[definers.length - 1];
    expect(
      assignsAgencyIdNull(fs.readFileSync(path.join(MIGRATIONS_DIR, lastDefiner), 'utf8')),
    ).toBe(false);
  });

  it('documents idempotent recruiting sync + visibility soft-end in canonical RPC', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    const sql = fs.readFileSync(full, 'utf8');
    expect(sql).toMatch(/representation_ended/i);
    expect(sql).toMatch(/is_visible_(commercial|fashion)\s*=\s*false/i);
    expect(sql).toMatch(/agency_relationship_status\s*=\s*'ended'/);
  });
});
