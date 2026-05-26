import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression: dashboard today_events must count synced calendar rows that
 * pre-20261332 lacked organization_id (owner_id party match fallback).
 */
describe('20261332_dashboard_summary_today_events_org_parity migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261332_dashboard_summary_today_events_org_parity.sql',
  );

  it('exists and patches get_dashboard_summary today_events + sync triggers', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('get_dashboard_summary');
    expect(sql).toContain('v_today_events');
    expect(sql).toContain('uce.organization_id = p_org_id');
    expect(sql).toContain('uce.owner_id = v_agency_id');
    expect(sql).toContain('organization_id');
    expect(sql).toContain('sync_user_calendars_on_option_confirmed');
    expect(sql).toContain('sync_user_calendars_on_option_job_confirmed');
  });
});
