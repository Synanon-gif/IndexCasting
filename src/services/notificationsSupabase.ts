/**
 * Notification service — Supabase-backed.
 * Handles creating, reading, marking as read, and real-time subscriptions
 * for the `notifications` table.
 *
 * Each notification targets either a specific user (user_id) or every
 * member of an organization (organization_id). RLS enforces visibility.
 */
import { supabase } from '../../lib/supabase';
import { pooledSubscribe } from './realtimeChannelPool';
import { enqueueNotification } from '../utils/notificationBatcher';

/** Spezifische Felder für notifications — kein SELECT * mehr. */
const NOTIFICATION_SELECT =
  'id, user_id, organization_id, type, title, message, metadata, is_read, created_at' as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType =
  // Core messaging
  | 'new_message'
  | 'new_option_message'
  | 'new_recruiting_message'
  // Option / Casting / Job request lifecycle
  | 'new_option_request'
  | 'option_request'
  | 'option_update'
  | 'awaiting_model_confirmation'
  | 'agency_counter_offer'
  | 'client_rejected_counter'
  | 'job_confirmed'
  | 'request_rejected_by_agency'
  | 'request_rejected_by_model'
  | 'model_confirmed'
  // Booking lifecycle
  | 'booking_request'
  | 'booking_accepted'
  | 'booking_confirmed'
  | 'booking_cancelled'
  // Recruiting / Applications
  | 'application_received'
  | 'application_model_confirmed'
  | 'application_accepted'
  | 'application_rejected'
  // System / Admin
  | 'verification_approved'
  | 'verification_rejected'
  | 'invitation'
  | 'system';

export type Notification = {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  type: NotificationType | string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

export type CreateNotificationParams = {
  /** Target a specific user. Provide either user_id or organization_id (or both). */
  user_id?: string | null;
  /** Target all members of an organization. */
  organization_id?: string | null;
  type: NotificationType | string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Inserts one notification row. Silently logs errors — callers must not throw.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const callerId = user?.id ?? null;
    const targetUserId = params.user_id ?? null;

    // Cross-party notification (sender ≠ target, no org scope):
    // Use the SECURITY DEFINER RPC that validates the sender↔target relationship.
    // This prevents spam/phishing across unrelated organizations.
    const isCrossParty =
      targetUserId !== null && targetUserId !== callerId && !params.organization_id;

    if (isCrossParty) {
      const { error: rpcError } = await supabase.rpc('send_notification', {
        p_target_user_id: targetUserId,
        p_type: params.type,
        p_title: params.title,
        p_message: params.message,
        p_metadata: params.metadata ?? {},
      });
      if (rpcError) {
        console.error('createNotification (cross-party RPC) error:', rpcError);
      }
      return;
    }

    const orgId = params.organization_id ?? null;
    const meta = (params.metadata ?? {}) as Record<string, unknown>;

    // Org broadcast (user_id null): clients/models are not members of the target org — use DEFINER RPCs.
    if (orgId && targetUserId === null) {
      const optId = typeof meta.option_request_id === 'string' ? meta.option_request_id : null;
      const threadId = typeof meta.thread_id === 'string' ? meta.thread_id : null;

      if (optId) {
        const { error: rpcError } = await supabase.rpc('notify_org_for_option_request', {
          p_option_request_id: optId,
          p_target_organization_id: orgId,
          p_type: params.type,
          p_title: params.title,
          p_message: params.message,
          p_metadata: meta,
        });
        if (rpcError) {
          console.error('createNotification (notify_org_for_option_request) error:', rpcError);
        }
        return;
      }

      if (threadId) {
        const { error: rpcError } = await supabase.rpc('notify_org_for_recruiting_thread', {
          p_thread_id: threadId,
          p_target_organization_id: orgId,
          p_type: params.type,
          p_title: params.title,
          p_message: params.message,
          p_metadata: meta,
        });
        if (rpcError) {
          console.error('createNotification (notify_org_for_recruiting_thread) error:', rpcError);
        }
        return;
      }

      const bookingId = typeof meta.booking_id === 'string' ? meta.booking_id : null;
      if (bookingId) {
        const { error: rpcError } = await supabase.rpc('notify_org_for_booking_event', {
          p_booking_id: bookingId,
          p_target_organization_id: orgId,
          p_type: params.type,
          p_title: params.title,
          p_message: params.message,
          p_metadata: meta,
        });
        if (rpcError) {
          console.error('createNotification (notify_org_for_booking_event) error:', rpcError);
        }
        return;
      }
    }

    // Self-targeting, org member org-wide, or legacy paths without option/thread metadata.
    // Batched: rows are collected and flushed as a single bulk INSERT within ~80ms.
    enqueueNotification({
      user_id: targetUserId,
      organization_id: orgId,
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: meta,
    });
  } catch (e) {
    console.error('createNotification exception:', e);
  }
}

/**
 * Creates multiple notifications in parallel. Each call is fire-and-forget —
 * failure of one does not affect the others.
 */
export async function createNotifications(
  notifications: CreateNotificationParams[],
): Promise<void> {
  await Promise.all(notifications.map(createNotification));
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetches all notifications visible to the current authenticated user.
 * Includes both direct (user_id) and organization-scoped rows — RLS handles
 * the filtering automatically.
 */
export async function getNotificationsForCurrentUser(): Promise<Notification[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('notifications')
      .select(NOTIFICATION_SELECT)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('getNotificationsForCurrentUser error:', error);
      return [];
    }
    return (data ?? []) as Notification[];
  } catch (e) {
    console.error('getNotificationsForCurrentUser exception:', e);
    return [];
  }
}

// ── Mark as read ──────────────────────────────────────────────────────────────

export async function markNotificationAsRead(id: string): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .or(`user_id.eq.${user.id},organization_id.not.is.null`);
    if (error) {
      console.error('markNotificationAsRead error:', error);
    }
  } catch (e) {
    console.error('markNotificationAsRead exception:', e);
  }
}

export async function markAllNotificationsAsRead(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const orgIds = await getUserOrganizationIds(user.id);

    // Build the OR filter carefully: if the user has no org memberships,
    // an empty `organization_id.in.()` clause is invalid in PostgREST.
    // Only include the org clause when there are org IDs to filter on.
    const orFilter = orgIds
      ? `user_id.eq.${user.id},organization_id.in.(${orgIds})`
      : `user_id.eq.${user.id}`;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false)
      .or(orFilter);
    if (error) {
      console.error('markAllNotificationsAsRead error:', error);
    }
  } catch (e) {
    console.error('markAllNotificationsAsRead exception:', e);
  }
}

// ── Real-time subscription ─────────────────────────────────────────────────────

/**
 * Subscribes to new notifications for the given user.
 * Uses the shared channel pool to avoid duplicate WebSocket channels.
 * Returns a cleanup function — call on component unmount.
 */
export function subscribeToUserNotifications(
  userId: string,
  onNotification: (n: Notification) => void,
): () => void {
  return pooledSubscribe(
    `notifications-user-${userId}`,
    (channel, dispatch) =>
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          dispatch,
        )
        .subscribe(),
    (payload) => onNotification((payload as { new: Notification }).new),
  );
}

/**
 * Subscribes to new notifications targeted at an organization.
 * Returns a cleanup function — call on component unmount.
 */
export function subscribeToOrgNotifications(
  organizationId: string,
  onNotification: (n: Notification) => void,
): () => void {
  return pooledSubscribe(
    `notifications-org-${organizationId}`,
    (channel, dispatch) =>
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `organization_id=eq.${organizationId}`,
          },
          dispatch,
        )
        .subscribe(),
    (payload) => onNotification((payload as { new: Notification }).new),
  );
}

// ── Push Token Registration ───────────────────────────────────────────────────

export type PushTokenPlatform = 'ios' | 'android' | 'web';

/**
 * Registriert (oder reaktiviert) einen Expo-Push-Token für den eingeloggten User.
 * Wird beim App-Start nach Erteilung der Notification-Permission aufgerufen.
 *
 * Idempotent: Bei erneutem Aufruf mit demselben Token wird nur `is_active = true`
 * gesetzt (ON CONFLICT DO UPDATE).
 */
export async function registerPushToken(token: string, platform: PushTokenPlatform): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: user.id, token, platform, is_active: true },
        { onConflict: 'user_id,token' },
      );

    if (error) {
      console.error('registerPushToken error:', error);
    }
  } catch (e) {
    console.error('registerPushToken exception:', e);
  }
}

/**
 * Deaktiviert einen Push-Token (z.B. beim Logout oder wenn der User
 * Notifications deaktiviert). Soft-delete via is_active = false.
 */
export async function deregisterPushToken(token: string): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('push_tokens')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('token', token);

    if (error) {
      console.error('deregisterPushToken error:', error);
    }
  } catch (e) {
    console.error('deregisterPushToken exception:', e);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a comma-separated list of organization IDs the user belongs to,
 * for use in Supabase `.or()` filter strings. Returns empty string on error.
 */
async function getUserOrganizationIds(userId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);
    if (error || !data) return '';
    return (data as { organization_id: string }[]).map((r) => r.organization_id).join(',');
  } catch {
    return '';
  }
}

/**
 * Convenience: fetches the organization IDs for a user as an array.
 * Used by the store to wire org-level subscriptions.
 */
export async function fetchUserOrganizationIds(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);
    if (error || !data) return [];
    return (data as { organization_id: string }[]).map((r) => r.organization_id);
  } catch {
    return [];
  }
}
