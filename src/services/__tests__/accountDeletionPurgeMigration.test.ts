/**
 * Regression guard: account deletion RPCs must set is_active=false so
 * gdpr_purge_expired_deletions (deletion_requested_at + is_active=false) can run.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');
const CANONICAL = '20260524_fix_account_deletion_purge_eligibility.sql';

describe('account deletion purge eligibility migration', () => {
  it('canonical migration sets is_active=false on deletion request RPCs', () => {
    const full = path.join(MIGRATIONS_DIR, CANONICAL);
    expect(fs.existsSync(full)).toBe(true);
    const sql = fs.readFileSync(full, 'utf8');

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.request_account_deletion/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.request_personal_account_deletion/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.cancel_account_deletion/i);

    const requestAccountBlock = sql.split(
      'CREATE OR REPLACE FUNCTION public.request_personal_account_deletion',
    )[0];
    expect(requestAccountBlock).toMatch(/is_active\s*=\s*false/i);

    const personalBlock = sql.split('CREATE OR REPLACE FUNCTION public.cancel_account_deletion')[0];
    expect(personalBlock).toMatch(/request_personal_account_deletion[\s\S]*is_active\s*=\s*false/i);

    expect(sql).toMatch(/cancel_account_deletion[\s\S]*is_active\s*=\s*true/i);
  });

  it('deletion RPCs use SECURITY DEFINER with row_security off', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, CANONICAL), 'utf8');
    const fnBlocks = [
      'request_account_deletion',
      'request_personal_account_deletion',
      'cancel_account_deletion',
    ];
    for (const fn of fnBlocks) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const chunk = sql.slice(start, start + 800);
      expect(chunk).toMatch(/SECURITY DEFINER/i);
      expect(chunk).toMatch(/SET row_security TO off/i);
    }
  });

  it('gdpr purge orchestrator still filters on is_active=false (unchanged contract)', () => {
    const orchestrator = path.join(
      MIGRATIONS_DIR,
      '20260813_security_gdpr_retention_orchestrator.sql',
    );
    expect(fs.existsSync(orchestrator)).toBe(true);
    const sql = fs.readFileSync(orchestrator, 'utf8');
    expect(sql).toMatch(/is_active\s*=\s*false/i);
    expect(sql).toMatch(/deletion_requested_at/i);
  });
});
