/**
 * Activity logs service (audit light).
 *
 * Reads via get_latest_activity_log RPC (org-scoped, member-only).
 * Writes via log_activity RPC (SECURITY DEFINER, membership verified server-side).
 * All calls are fire-and-forget safe: errors are logged but never thrown.
 */
import { supabase } from '../../lib/supabase';

export interface ActivityLog {
  action_type: string;
  entity_id: string | null;
  created_at: string;
  actor_name: string;
}

/**
 * Returns the most recent activity log entry for an organization,
 * including the display name of the acting user.
 * Returns null if no logs exist or on error.
 */
export async function getLatestActivityLog(orgId: string): Promise<ActivityLog | null> {
  try {
    const { data, error } = await supabase.rpc('get_latest_activity_log', {
      p_org_id: orgId,
    });
    if (error) throw error;
    return data as ActivityLog | null;
  } catch (err) {
    console.error('[activityLogsSupabase] getLatestActivityLog error:', err);
    return null;
  }
}

/**
 * Logs a user action to the activity_logs table.
 * Safe to call fire-and-forget — never throws.
 */
export async function logActivity(
  orgId: string,
  actionType: string,
  entityId?: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_activity', {
      p_org_id: orgId,
      p_action_type: actionType,
      p_entity_id: entityId ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[activityLogsSupabase] logActivity error:', err);
  }
}

/** Convenience action-type constants to keep action strings consistent. */
export const ActivityAction = {
  OPTION_SENT: 'option_sent',
  OPTION_CONFIRMED: 'option_confirmed',
  OPTION_REJECTED: 'option_rejected',
  BOOKING_CONFIRMED: 'booking_confirmed',
  MODEL_ADDED: 'model_added',
  MODEL_REMOVED: 'model_removed',
  MESSAGE_SENT: 'message_sent',
  MEMBER_INVITED: 'member_invited',
  MEMBER_REMOVED: 'member_removed',
} as const;

export type ActivityActionType = (typeof ActivityAction)[keyof typeof ActivityAction];
