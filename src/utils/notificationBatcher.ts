/**
 * Notification Batcher — collects direct-insert notifications within a short
 * time window and flushes them as a single bulk INSERT, reducing HTTP round-trips
 * from N to 1.
 *
 * Only notifications that go through the direct `.from('notifications').insert()`
 * path are batchable. Cross-party RPCs (send_notification, notify_org_for_*)
 * bypass the batcher and execute immediately.
 */
import { supabase } from '../../lib/supabase';

type BatchableRow = {
  user_id: string | null;
  organization_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
};

const FLUSH_DELAY_MS = 80;
const MAX_BATCH_SIZE = 100;

const queue: BatchableRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_DELAY_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue.splice(0, MAX_BATCH_SIZE);

  try {
    const { error } = await supabase.from('notifications').insert(batch);
    if (error) {
      console.error('[notificationBatcher] bulk insert error:', error, `(${batch.length} rows)`);
    }
  } catch (e) {
    console.error('[notificationBatcher] bulk insert exception:', e);
  }

  if (queue.length > 0) {
    scheduleFlush();
  }
}

/**
 * Enqueues a notification row for batched insert.
 * The row will be flushed within ~80ms together with other queued rows.
 */
export function enqueueNotification(row: BatchableRow): void {
  queue.push(row);

  if (queue.length >= MAX_BATCH_SIZE) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushQueue();
  } else {
    scheduleFlush();
  }
}

/**
 * Immediately flushes all queued notifications. Useful for cleanup / unmount.
 */
export async function flushNotifications(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushQueue();
}

/** Visible for testing only */
export function _getQueueLength(): number {
  return queue.length;
}
