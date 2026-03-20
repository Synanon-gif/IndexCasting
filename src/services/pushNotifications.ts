/**
 * Push / local notification hooks (GDPR: no content beyond what the user already authorized).
 * Wire Expo / FCM here for production mobile; web uses Browser Notifications when permitted.
 */

export async function requestNotificationPermissionIfWeb(): Promise<NotificationPermission | 'unsupported'> {
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

/** Called when the agency sends a counter-offer so the client can open Messages. */
export function notifyClientAgencyCounterOffer(agencyDisplayName: string): void {
  const title = `${agencyDisplayName} proposed a new price`;
  const body = 'Open Messages to review the counter-offer.';
  if (typeof window !== 'undefined' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
  console.info('[notifications]', title, '— integrate Expo Notifications / FCM for native apps.');
}
