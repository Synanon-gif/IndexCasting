import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression: dashboard RPC must stay aligned with option/calendar lifecycle
 * (reject → cancelled / not counted; delete → row gone; accept → still today).
 */
describe('20261333_get_dashboard_summary_lifecycle_parity migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261333_get_dashboard_summary_lifecycle_parity.sql',
  );

  it('exists and enforces client org + lifecycle filters', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('get_dashboard_summary');
    expect(sql).toContain('COALESCE(r.client_organization_id, r.organization_id) = p_org_id');
    expect(sql).toContain("r.status = 'in_negotiation'");
    expect(sql).toContain("COALESCE(uce.status, 'active') <> 'cancelled'");
    expect(sql).toContain('uce.source_option_request_id IS NULL');
    expect(sql).toContain('orq.status IS DISTINCT FROM');
    expect(sql).toContain("'rejected'");
    expect(sql).toContain("metadata->>'status', '') IN ('deleted', 'rejected')");
  });
});
