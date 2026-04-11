/**
 * Notifications store — in-memory cache + pub/sub pattern.
 * Follows the same structure as recruitingChats.ts.
 *
 * Usage:
 *   const unsub = subscribeNotifications(() => {
 *     const { notifications, unreadCount } = getNotificationsState();
 *     // re-render
 *   });
 *   ensureHydrated(userId);  // call once after sign-in
 *   // on sign-out:
 *   resetNotificationsStore();
 */

import {
  getNotificationsForCurrentUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  subscribeToUserNotifications,
  subscribeToOrgNotifications,
  fetchUserOrganizationIds,
  type Notification,
} from '../services/notificationsSupabase';

// ── State ─────────────────────────────────────────────────────────────────────

let cache: Notification[] = [];
let hydrated = false;
let currentUserId: string | null = null;
let cleanupFns: Array<() => void> = [];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

// ── Public API ────────────────────────────────────────────────────────────────

export type NotificationsState = {
  notifications: Notification[];
  unreadCount: number;
};

export function getNotificationsState(): NotificationsState {
  return {
    notifications: [...cache],
    unreadCount: cache.filter((n) => !n.is_read).length,
  };
}

/**
 * Subscribe to store changes. Returns an unsubscribe function.
 * Automatically triggers hydration for the given userId on first call.
 */
export function subscribeNotifications(
  fn: () => void,
  userId?: string,
): () => void {
  listeners.add(fn);
  if (userId) {
    ensureHydrated(userId);
  }
  return () => listeners.delete(fn);
}

/**
 * Load notifications from DB and set up real-time subscriptions.
 * Safe to call multiple times — only runs once per session.
 */
export async function ensureHydrated(userId: string): Promise<void> {
  if (hydrated && currentUserId === userId) return;

  // Tear down any previous subscriptions (e.g. after role switch)
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];

  hydrated = true;
  currentUserId = userId;

  const data = await getNotificationsForCurrentUser();
  cache = data;
  notify();

  // Subscribe to direct-user notifications
  const unsubUser = subscribeToUserNotifications(userId, (n) => {
    cache = [n, ...cache];
    notify();
  });
  cleanupFns.push(unsubUser);

  // Subscribe to org-level notifications for each org the user belongs to
  const orgIds = await fetchUserOrganizationIds(userId);
  for (const orgId of orgIds) {
    const unsubOrg = subscribeToOrgNotifications(orgId, (n) => {
      // Avoid duplicates if the user already received it via user_id channel
      if (cache.some((c) => c.id === n.id)) return;
      cache = [n, ...cache];
      notify();
    });
    cleanupFns.push(unsubOrg);
  }

  // Refresh from DB when the page/app returns to foreground.
  // Covers cases where realtime missed an UPDATE (mark-as-read on other device)
  // or INSERT events were lost during background/sleep.
  if (typeof document !== 'undefined') {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshNotifications();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    cleanupFns.push(() => document.removeEventListener('visibilitychange', handleVisibility));
  }
}

/**
 * Mark a single notification as read — updates cache immediately, then persists.
 */
export async function setNotificationRead(id: string): Promise<void> {
  cache = cache.map((n) => (n.id === id ? { ...n, is_read: true } : n));
  notify();
  await markNotificationAsRead(id);
}

/**
 * Mark all cached notifications as read — optimistic update + persist.
 */
export async function setAllNotificationsRead(): Promise<void> {
  cache = cache.map((n) => ({ ...n, is_read: true }));
  notify();
  await markAllNotificationsAsRead();
}

/**
 * Force a full refresh from the DB (e.g. after returning to foreground).
 */
export async function refreshNotifications(): Promise<void> {
  if (!currentUserId) return;
  const data = await getNotificationsForCurrentUser();
  cache = data;
  notify();
}

/**
 * Reset all state (call on sign-out).
 */
export function resetNotificationsStore(): void {
  cache = [];
  hydrated = false;
  currentUserId = null;
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  notify();
}
