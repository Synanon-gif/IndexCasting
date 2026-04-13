/**
 * Security event logger.
 * Logs security-relevant rejections to the `security_events` table.
 * Fire-and-forget — never throws, never blocks the calling code.
 *
 * Usage:
 *   void logSecurityEvent({ type: 'xss_attempt', userId: senderId, metadata: { input: '...' } });
 *
 * IMPORTANT: Never include raw user input or internal stack traces in metadata.
 * Only include safe, opaque identifiers and event type.
 */

import { supabase } from '../supabase';

export type SecurityEventType =
  | 'xss_attempt'
  | 'invalid_url'
  | 'file_rejected'
  | 'mime_mismatch'
  | 'extension_mismatch'
  | 'rate_limit'
  | 'large_payload'
  | 'magic_bytes_fail'
  | 'unsafe_content';

export interface SecurityEventPayload {
  type: SecurityEventType;
  /** Supabase auth user ID — null for unauthenticated requests */
  userId?: string | null;
  /** Organization ID if available */
  orgId?: string | null;
  /**
   * Safe opaque metadata — DO NOT include raw user input, stack traces,
   * or internal implementation details.
   */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Logs a security event to the `security_events` table.
 * Always fire-and-forget: wrap call in `void` and never await.
 *
 * RLS on security_events requires user_id = auth.uid(). When userId is not
 * supplied, the function auto-resolves from the current session. If no
 * authenticated session exists, the event is logged to console only — the
 * DB insert is skipped to avoid RLS violations.
 */
export async function logSecurityEvent(event: SecurityEventPayload): Promise<void> {
  try {
    let userId = event.userId ?? null;

    if (!userId) {
      try {
        const { data } = await supabase.auth.getUser();
        userId = data?.user?.id ?? null;
      } catch {
        // auth lookup failed — will skip DB insert below
      }
    }

    if (!userId) {
      console.warn('logSecurityEvent: no authenticated user — skipping DB insert', event.type, event.metadata);
      return;
    }

    const { error } = await supabase.from('security_events').insert({
      user_id: userId,
      org_id: event.orgId ?? null,
      type: event.type,
      metadata: event.metadata ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('logSecurityEvent: failed to write event', event.type, error.message);
    }
  } catch (e) {
    console.warn('logSecurityEvent: unexpected error', event.type, e);
  }
}
