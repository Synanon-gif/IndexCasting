/**
 * Org metrics service (owner-only reporting).
 *
 * Calls get_org_metrics RPC which enforces owner role server-side.
 * Non-owners receive an access denied error from the RPC.
 */
import { supabase } from '../../lib/supabase';

export interface OrgMetrics {
  total_options: number;
  confirmed_options: number;
  conversion_rate: number;
}

/**
 * Fetches aggregated option metrics for an organization.
 * Returns null if the caller is not an owner or on any error.
 */
export async function getOrgMetrics(orgId: string): Promise<OrgMetrics | null> {
  try {
    const { data, error } = await supabase.rpc('get_org_metrics', {
      p_org_id: orgId,
    });
    if (error) throw error;
    return data as OrgMetrics;
  } catch (err) {
    console.error('[orgMetricsSupabase] getOrgMetrics error:', err);
    return null;
  }
}
