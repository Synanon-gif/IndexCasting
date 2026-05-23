/**
 * Regression: casting requests must not accept Axis-1 price RPCs or direct price UPDATEs.
 * Scans supabase/migrations/ like hotRpcMigrationsRegression.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');
const CANONICAL = '20261331_casting_block_price_negotiation_rpcs.sql';

const CASTING_PRICE_GUARD = /price_negotiation_not_applicable_for_casting/i;

function readMigration(file: string): string {
  const full = path.join(MIGRATIONS_DIR, file);
  expect(fs.existsSync(full)).toBe(true);
  return fs.readFileSync(full, 'utf8');
}

function latestMigrationDefining(fnName: string): { file: string; sql: string } | null {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\s*\\(`,
    'is',
  );
  let last: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (pattern.test(sql)) last = { file, sql };
  }
  return last;
}

describe('casting price RPC hardening migration (20261331)', () => {
  it('canonical migration exists with trigger + casting guard marker', () => {
    const sql = readMigration(CANONICAL);
    expect(sql).toMatch(CASTING_PRICE_GUARD);
    expect(sql).toMatch(/fn_block_casting_price_axis_mutations/i);
    expect(sql).toMatch(/tr_block_casting_price_axis_mutations/i);
  });

  it('latest agency_set_counter_offer rejects casting', () => {
    const latest = latestMigrationDefining('agency_set_counter_offer');
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(CANONICAL);
    expect(latest!.sql).toMatch(/v_request_type\s*=\s*'casting'/i);
    expect(latest!.sql).toMatch(CASTING_PRICE_GUARD);
  });

  it('latest client_accept_counter_offer excludes casting in SELECT/UPDATE', () => {
    const latest = latestMigrationDefining('client_accept_counter_offer');
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(CANONICAL);
    expect(latest!.sql).toMatch(/request_type::text,\s*'option'\)\s*<>\s*'casting'/i);
  });

  it('latest agency_confirm_client_price excludes casting', () => {
    const latest = latestMigrationDefining('agency_confirm_client_price');
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(CANONICAL);
    expect(latest!.sql).toMatch(/request_type::text,\s*'option'\)\s*<>\s*'casting'/i);
  });

  it('latest client_reject_counter_offer excludes casting', () => {
    const latest = latestMigrationDefining('client_reject_counter_offer');
    expect(latest).not.toBeNull();
    expect(latest!.file).toBe(CANONICAL);
    expect(latest!.sql).toMatch(/request_type::text,\s*'option'\)\s*<>\s*'casting'/i);
  });

  it('latest agency_set_counter_offer still allows in_negotiation OR confirmed (options)', () => {
    const sql = readMigration(CANONICAL);
    expect(sql).toMatch(/status\s+IN\s*\(\s*'in_negotiation'\s*,\s*'confirmed'\s*\)/is);
  });
});
