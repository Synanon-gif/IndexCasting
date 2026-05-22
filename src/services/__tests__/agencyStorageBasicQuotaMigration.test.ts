/**
 * Regression fence: Agency Basic storage quota MUST stay 10 GB across
 * migrations, RPC fallbacks, frontend constants, and admin copy.
 *
 * Do not remove or weaken without equivalent replacement tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');

const CANONICAL_MIGRATION = '20261330_agency_basic_storage_quota_10gb.sql';
const LEGACY_BASIC_BYTES = 5 * 1024 * 1024 * 1024; // 5368709120
const CANONICAL_BASIC_BYTES = 10 * 1024 * 1024 * 1024; // 10737418240

const STORAGE_RPC_FUNCTIONS = [
  'get_plan_storage_limit',
  'increment_agency_storage_usage',
  'get_my_agency_storage_usage',
  'admin_get_org_storage_usage',
] as const;

function readFile(relativePath: string): string {
  const full = path.join(ROOT, relativePath);
  expect(fs.existsSync(full)).toBe(true);
  return fs.readFileSync(full, 'utf8');
}

function definesFunction(sql: string, fn: string): boolean {
  return new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, 'is').test(sql);
}

function latestMigrationDefining(fn: string): { file: string; sql: string } | null {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let last: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (definesFunction(sql, fn)) last = { file, sql };
  }
  return last;
}

function hasLegacyFiveGbDefault(sql: string): boolean {
  return /\bv_default_limit\s+BIGINT\s*:=\s*5368709120\b/is.test(sql);
}

function hasLegacyBasicPlanLimit(sql: string): boolean {
  return (
    /WHEN\s+'agency_basic'\s+THEN\s+5368709120\b/is.test(sql) ||
    /WHEN\s+'agency_basic'\s+THEN\s+5\s*\*\s*1024/is.test(sql)
  );
}

describe('agency storage Basic 10 GB migration regression fence', () => {
  it('canonical migration exists and encodes 10 GB (not 5 GB fallback)', () => {
    const sql = readFile(`supabase/migrations/${CANONICAL_MIGRATION}`);
    expect(hasLegacyFiveGbDefault(sql)).toBe(false);
    expect(hasLegacyBasicPlanLimit(sql)).toBe(false);
    expect(sql).toMatch(/WHEN\s+'agency_basic'\s+THEN\s+10737418240/is);
    expect(sql).toMatch(/v_default_limit\s+BIGINT\s*:=\s*10737418240/is);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_plan_storage_limit/is);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.increment_agency_storage_usage/is);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_agency_storage_usage/is);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_get_org_storage_usage/is);
  });

  it.each(STORAGE_RPC_FUNCTIONS)(
    'latest migration defining %s must not regress to 5 GB default',
    (fn) => {
      const latest = latestMigrationDefining(fn);
      expect(latest).not.toBeNull();
      expect(latest!.file >= CANONICAL_MIGRATION).toBe(true);
      expect(hasLegacyFiveGbDefault(latest!.sql)).toBe(false);
      if (fn === 'get_plan_storage_limit') {
        expect(hasLegacyBasicPlanLimit(latest!.sql)).toBe(false);
        expect(latest!.sql).toMatch(/WHEN\s+'agency_basic'\s+THEN\s+10737418240/is);
      }
    },
  );

  it('no migration after canonical reintroduces 5 GB storage defaults', () => {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f > CANONICAL_MIGRATION)
      .sort();

    const violations: string[] = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const touchesStorageRpc = STORAGE_RPC_FUNCTIONS.some((fn) => definesFunction(sql, fn));
      if (!touchesStorageRpc) continue;
      if (hasLegacyFiveGbDefault(sql) || hasLegacyBasicPlanLimit(sql)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('frontend AGENCY_STORAGE_LIMIT_BYTES stays 10 GB', () => {
    const src = readFile('src/services/agencyStorageSupabase.ts');
    expect(src).toMatch(/AGENCY_STORAGE_LIMIT_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/);
    expect(src).not.toMatch(/AGENCY_STORAGE_LIMIT_BYTES\s*=\s*5\s*\*\s*1024/);
  });

  it('PLAN_LIMITS.agency_basic.storageGB stays 10 in subscriptionSupabase', () => {
    const src = readFile('src/services/subscriptionSupabase.ts');
    expect(src).toMatch(/agency_basic:\s*\{[^}]*storageGB:\s*10/s);
    expect(src).not.toMatch(/agency_basic:\s*\{[^}]*storageGB:\s*5[^0-9]/s);
  });

  it('uiCopy admin storage default label must not say 5 GB', () => {
    const src = readFile('src/constants/uiCopy.ts');
    expect(src).toMatch(/storageLimitDefault:\s*'Default \(10 GB\)'/);
    expect(src).not.toMatch(/storageLimitDefault:\s*'Default \(5 GB\)'/);
    expect(src).not.toMatch(/default 5 GB storage limit/i);
  });

  it('canonical byte constants are distinct (10 GB ≠ legacy 5 GB)', () => {
    expect(CANONICAL_BASIC_BYTES).toBe(10_737_418_240);
    expect(LEGACY_BASIC_BYTES).toBe(5_368_709_120);
    expect(CANONICAL_BASIC_BYTES).not.toBe(LEGACY_BASIC_BYTES);
  });
});
