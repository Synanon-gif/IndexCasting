/**
 * Dashboard summary service.
 *
 * Calls the get_dashboard_summary SECURITY DEFINER RPC which enforces
 * org-membership before returning any counts. All values are scoped to
 * the caller's organization — no cross-org data is ever returned.
 */
import { supabase } from '../../lib/supabase';

export interface DashboardSummary {
  open_option_requests: number;
  unread_threads: number;
  today_events: number;
}

/**
 * Fetches the dashboard summary counts for a given organization.
 * Returns null on error or when the caller is not a member of the org.
 */
export async function getDashboardSummary(
  orgId: string,
  userId: string,
): Promise<DashboardSummary | null> {
  try {
    const { data, error } = await supabase.rpc('get_dashboard_summary', {
      p_org_id: orgId,
      p_user_id: userId,
    });
    if (error) throw error;
    return data as DashboardSummary;
  } catch (err) {
    console.error('[dashboardSupabase] getDashboardSummary error:', err);
    return null;
  }
}
