/**
 * Push / local notification hooks (GDPR: no content beyond what the user already authorized).
 * Handles Expo push token registration for native iOS/Android and Browser Notifications for web.
 */

import { Platform } from 'react-native';
import * as ExpoNotifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken, deregisterPushToken } from './notificationsSupabase';

export async function requestNotificationPermissionIfWeb(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch {
    return 'denied';
  }
}

/**
 * Requests push notification permission and registers the Expo push token.
 * - Native (iOS/Android): uses expo-notifications to get the Expo Push Token.
 * - Web: uses Browser Notification API (no Expo token, no DB registration).
 *
 * Call this once after the user is authenticated (e.g. on session start).
 * Idempotent: safe to call on every app launch; the DB upsert handles duplicates.
 */
export async function initializePushNotifications(): Promise<void> {
  if (Platform.OS === 'web') {
    // Web: request browser permission only (no Expo token to store)
    await requestNotificationPermissionIfWeb();
    return;
  }

  try {
    // Check if running in an Expo Go / physical device context with a valid project ID
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

    if (!projectId) {
      // Running in a bare-React-Native or dev environment without EAS — skip gracefully.
      console.info('[pushNotifications] No EAS projectId found, skipping push token registration.');
      return;
    }

    const { status: existingStatus } = await ExpoNotifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await ExpoNotifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.info('[pushNotifications] Push permission not granted.');
      return;
    }

    const tokenData = await ExpoNotifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    await registerPushToken(token, platform);
    console.info('[pushNotifications] Push token registered.');
  } catch (e) {
    // Non-fatal: push notifications unavailable (emulator, restricted environment)
    console.warn('[pushNotifications] Could not register push token:', e);
  }
}

/**
 * Deregisters the push token on logout to prevent notifications being sent
 * to devices that are no longer associated with this session.
 */
export async function teardownPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
    if (!projectId) return;

    const tokenData = await ExpoNotifications.getExpoPushTokenAsync({ projectId });
    await deregisterPushToken(tokenData.data);
  } catch {
    // Non-fatal
  }
}

/**
 * Notification response handler type — called when user taps a push notification.
 * The handler receives the notification type and metadata for navigation.
 */
export type PushTapHandler = (data: {
  type: string;
  option_request_id?: string;
  thread_id?: string;
  notification_id?: string;
  [key: string]: unknown;
}) => void;

let pushTapHandler: PushTapHandler | null = null;
let responseSubscription: ExpoNotifications.Subscription | null = null;
let tokenRefreshSubscription: ExpoNotifications.Subscription | null = null;

/**
 * Register a handler that is called when the user taps a push notification.
 * The handler should navigate to the relevant screen based on `data.type`.
 * Call this once from App.tsx after navigation is ready.
 */
export function setPushTapHandler(handler: PushTapHandler): () => void {
  pushTapHandler = handler;

  if (Platform.OS === 'web')
    return () => {
      pushTapHandler = null;
    };

  responseSubscription?.remove();
  responseSubscription = ExpoNotifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    if (data && pushTapHandler) {
      pushTapHandler({
        type: (data.type as string) ?? '',
        option_request_id: data.option_request_id as string | undefined,
        thread_id: data.thread_id as string | undefined,
        notification_id: data.notification_id as string | undefined,
        ...data,
      });
    }
  });

  return () => {
    pushTapHandler = null;
    responseSubscription?.remove();
    responseSubscription = null;
  };
}

/**
 * Start listening for Expo push token changes (OS can rotate tokens).
 * When a new token is received, re-register it in the DB.
 * Call once after initializePushNotifications succeeds.
 */
export function startTokenRefreshListener(): () => void {
  if (Platform.OS === 'web') return () => {};

  tokenRefreshSubscription?.remove();
  tokenRefreshSubscription = ExpoNotifications.addPushTokenListener(async (tokenEvent) => {
    try {
      const token = tokenEvent.data;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      await registerPushToken(token, platform);
      console.info('[pushNotifications] Token refreshed and re-registered.');
    } catch (e) {
      console.warn('[pushNotifications] Token refresh registration failed:', e);
    }
  });

  return () => {
    tokenRefreshSubscription?.remove();
    tokenRefreshSubscription = null;
  };
}

/** Called when the agency sends a counter-offer so the client can open Messages. */
export function notifyClientAgencyCounterOffer(agencyDisplayName: string): void {
  const title = `${agencyDisplayName} proposed a new price`;
  const body = 'Open Messages to review the counter-offer.';
  if (
    typeof window !== 'undefined' &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
}
