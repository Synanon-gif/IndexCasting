/**
 * Bulk INSERT helper for `notifications` — used by `notificationBatcher` only.
 * Kept separate from `notificationsSupabase.ts` to avoid a circular import with
 * `../utils/notificationBatcher`, which `notificationsSupabase` imports for enqueue.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export type NotificationBatchInsertRow = {
  user_id: string | null;
  organization_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
};

/** Same semantics as prior inline batch insert in `notificationBatcher` (RLS applies). */
export async function insertNotificationBatch(
  rows: NotificationBatchInsertRow[],
): Promise<{ error: PostgrestError | null }> {
  const { error } = await supabase.from('notifications').insert(rows);
  return { error };
}
