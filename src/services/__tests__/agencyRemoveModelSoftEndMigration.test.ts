/**
 * Guards the canonical live migration for agency_remove_model: soft-end must not
 * clear models.agency_id (NOT NULL / 23502 regression).
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');

describe('agency_remove_model migration policy (soft-end, no agency_id NULL)', () => {
  const canonical = '20261305_fix_agency_remove_model_soft_end.sql';

  it('canonical migration exists and never assigns agency_id to NULL inside the RPC body', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');
    expect(sql.toLowerCase()).not.toMatch(/agency_id\s*=\s*null/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_remove_model/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET row_security TO off/i);
  });

  it('the latest migrations-file definition of agency_remove_model is the canonical file (no later typo reintroduces NULL)', () => {
    const agencyRemoveFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && (f.includes('agency_remove_model') || f === canonical))
      .sort();

    expect(agencyRemoveFiles.length).toBeGreaterThan(0);
    expect(agencyRemoveFiles[agencyRemoveFiles.length - 1]).toBe(canonical);
  });

  it('documents idempotent recruiting sync + visibility soft-end clauses', () => {
    const full = path.join(MIGRATIONS_DIR, canonical);
    const sql = fs.readFileSync(full, 'utf8');
    expect(sql).toMatch(/representation_ended/i);
    expect(sql).toMatch(/is_visible_(commercial|fashion)\s*=\s*false/);
    expect(sql).toMatch(/agency_relationship_status\s*=\s*'ended'/);
  });
});
