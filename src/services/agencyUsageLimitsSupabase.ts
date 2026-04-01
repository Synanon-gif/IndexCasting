/**
 * Agency usage limits service.
 *
 * All reads and writes go through SECURITY DEFINER RPCs — normal users
 * never touch the agency_usage_limits table directly.
 *
 * Swipe limits are organisation-wide: every member (owner, booker) shares
 * the same counter and the same daily cap.
 */
import { supabase } from '../../lib/supabase';

export interface AgencyUsageLimits {
  organization_id: string;
  swipes_used_today: number;
  daily_swipe_limit: number;
  last_reset_date: string;
}

export interface SwipeCheckResult {
  allowed: boolean;
  swipes_used: number;
  limit: number;
  error?: string;
}

/**
 * Returns the current usage snapshot for the caller's agency organisation.
 * The RPC resets the counter automatically if the stored date is before today.
 * Returns null when no agency organisation is found or on network error.
 */
export async function getMyAgencyUsageLimits(): Promise<AgencyUsageLimits | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_agency_usage_limit');
    if (error) throw error;
    if (!data || (data as { error?: string }).error) return null;
    return data as AgencyUsageLimits;
  } catch (err) {
    console.error('[agencyUsageLimits] getMyAgencyUsageLimits error:', err);
    return null;
  }
}

/**
 * Atomically checks the daily limit and increments the counter if the swipe
 * is allowed.  On any unexpected DB error the function fails open (allowed:
 * true) so a network hiccup never blocks a legitimate swipe action.
 */
export async function incrementMyAgencySwipeCount(): Promise<SwipeCheckResult> {
  try {
    const { data, error } = await supabase.rpc('increment_my_agency_swipe_count');
    if (error) throw error;
    return data as SwipeCheckResult;
  } catch (err) {
    console.error('[agencyUsageLimits] incrementMyAgencySwipeCount error:', err);
    // Fail closed: a transient DB error must not silently bypass the daily limit.
    // The UI should show a "try again" message rather than allowing unlimited swipes.
    return { allowed: false, swipes_used: 0, limit: 0, error: 'Could not verify swipe limit. Please try again.' };
  }
}
