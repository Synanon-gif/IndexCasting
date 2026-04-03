/**
 * Server-side persistence for per-user thread preferences (e.g. archive status).
 * Replaces the localStorage-only ci_archived_threads approach.
 *
 * Each preference row is unique per (user_id, thread_id) — RLS ensures only
 * the owner can read or write their own rows.
 */

import { supabase } from '../../lib/supabase';

const TABLE = 'user_thread_preferences';

/**
 * Loads the set of archived thread IDs for the current user in a given org.
 * Returns an empty Set on error (fails silently — UI falls back to localStorage).
 */
export async function loadArchivedThreadIds(orgId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('thread_id')
      .eq('org_id', orgId)
      .eq('is_archived', true);
    if (error) {
      console.error('[threadPreferences] loadArchivedThreadIds error:', error);
      return new Set();
    }
    return new Set((data ?? []).map((r: { thread_id: string }) => r.thread_id));
  } catch (e) {
    console.error('[threadPreferences] loadArchivedThreadIds exception:', e);
    return new Set();
  }
}

/**
 * Upserts the archive flag for a thread. Idempotent.
 * Fails silently — caller should maintain a local optimistic state.
 */
export async function setThreadArchived(
  orgId: string,
  threadId: string,
  isArchived: boolean,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          user_id: user.id,
          org_id: orgId,
          thread_id: threadId,
          is_archived: isArchived,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,thread_id' },
      );
    if (error) {
      console.error('[threadPreferences] setThreadArchived error:', error);
    }
  } catch (e) {
    console.error('[threadPreferences] setThreadArchived exception:', e);
  }
}
