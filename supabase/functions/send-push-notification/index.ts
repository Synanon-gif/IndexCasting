/**
 * Edge Function: send-push-notification
 *
 * Wird via Supabase Database Webhook aufgerufen, sobald ein neuer Eintrag
 * in der `notifications`-Tabelle eingefügt wird (AFTER INSERT).
 *
 * Flow:
 *  1. Empfange Webhook-Payload mit der neuen Notification-Row.
 *  2. Ermittle alle aktiven Push-Tokens des Ziel-Users (+ Org-Members).
 *  3. Sende via Expo Push API (https://api.expo.dev/v2/push/send).
 *  4. Deaktiviere Tokens die als "DeviceNotRegistered" zurückkommen.
 *
 * Edge Location: Paris / NYC / Milan — läuft nah am Endnutzer.
 * DSGVO: Kein Token wird geloggt; Expo erhält nur anonymisierte Payload.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://api.expo.dev/v2/push/send';

/**
 * Constant-time string comparison to prevent timing-based secret enumeration.
 * Both sides are UTF-8 encoded before comparison so multi-byte characters are safe.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

/**
 * Allowed notification types.  Any payload with a type outside this set is
 * rejected before push tokens are looked up, preventing spoofed push
 * notifications with arbitrary type values. M-1 fix — Security Pentest 2026-04.
 */
const ALLOWED_NOTIFICATION_TYPES = new Set([
  'new_message',
  'booking_request',
  'booking_confirmed',
  'booking_cancelled',
  'option_request',
  'option_update',
  'verification_approved',
  'verification_rejected',
  'invitation',
  'system',
]);

interface NotificationRow {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: NotificationRow;
  schema: string;
}

interface PushToken {
  id: string;
  token: string;
  platform: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Nur POST-Requests verarbeiten
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Webhook-Secret zwingend prüfen — WEBHOOK_SECRET MUSS im Supabase Dashboard gesetzt sein.
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET env var is not set — rejecting request');
    return new Response('Service Unavailable: missing configuration', { status: 503 });
  }
  const receivedSecret = req.headers.get('x-webhook-secret') ?? '';
  if (!timingSafeEqual(receivedSecret, webhookSecret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json() as WebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (payload.type !== 'INSERT' || payload.table !== 'notifications' || payload.schema !== 'public') {
    return new Response('OK', { status: 200 });
  }

  const notification = payload.record;

  // Reject unknown notification types to prevent push spoofing via crafted payloads.
  if (!notification?.type || !ALLOWED_NOTIFICATION_TYPES.has(notification.type)) {
    console.warn('[send-push] Rejected unknown notification type:', notification?.type);
    return new Response('OK', { status: 200 });
  }

  // Validate required fields to avoid sending empty / malformed pushes.
  if (!notification.id || typeof notification.title !== 'string' || typeof notification.message !== 'string') {
    console.warn('[send-push] Rejected malformed notification record');
    return new Response('OK', { status: 200 });
  }

  // Supabase-Client mit Service Role für interne Abfragen
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Alle Ziel-User-IDs ermitteln (direkte User + Org-Members)
  const targetUserIds = new Set<string>();

  if (notification.user_id) {
    targetUserIds.add(notification.user_id);
  }

  if (notification.organization_id) {
    const { data: members } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', notification.organization_id);

    for (const m of members ?? []) {
      if (m.user_id) targetUserIds.add(m.user_id);
    }
  }

  if (targetUserIds.size === 0) {
    return new Response('No targets', { status: 200 });
  }

  // Aktive Push-Tokens für alle Ziel-User laden
  const { data: tokens, error: tokenError } = await supabase
    .from('push_tokens')
    .select('id, token, platform')
    .in('user_id', [...targetUserIds])
    .eq('is_active', true);

  if (tokenError) {
    console.error('push_tokens fetch error:', tokenError.message);
    return new Response('Token fetch failed', { status: 500 });
  }

  const pushTokens = (tokens ?? []) as PushToken[];

  // Nur Expo-Tokens (Format: ExponentPushToken[...] oder native)
  const expoTokens = pushTokens.filter(
    (t) => t.token.startsWith('ExponentPushToken[') || t.token.startsWith('ExpoPushToken['),
  );

  if (expoTokens.length === 0) {
    return new Response('No expo tokens', { status: 200 });
  }

  // Expo Push Messages aufbauen
  const messages: ExpoPushMessage[] = expoTokens.map((t) => ({
    to: t.token,
    title: notification.title,
    body: notification.message,
    data: {
      notification_id: notification.id,
      type: notification.type,
      ...notification.metadata,
    },
    sound: 'default',
    ...(t.platform === 'android' && { channelId: 'default' }),
  }));

  // An Expo Push API senden (max. 100 pro Request — Expo-Limit)
  const BATCH_SIZE = 100;
  const invalidTokenIds: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchTokens = expoTokens.slice(i, i + BATCH_SIZE);

    try {
      const expoPushRes = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(batch),
      });

      if (!expoPushRes.ok) {
        console.error('Expo Push API error:', expoPushRes.status);
        continue;
      }

      const result = await expoPushRes.json() as { data: ExpoPushTicket[] };

      // DeviceNotRegistered-Tokens deaktivieren (DSGVO: kein Logging der Token-Werte)
      result.data.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokenIds.push(batchTokens[idx].id);
        }
      });
    } catch (e) {
      console.error('Expo Push fetch exception:', e);
    }
  }

  // Ungültige Tokens soft-deaktivieren
  if (invalidTokenIds.length > 0) {
    await supabase
      .from('push_tokens')
      .update({ is_active: false })
      .in('id', invalidTokenIds);
  }

  return new Response(
    JSON.stringify({ sent: expoTokens.length, deactivated: invalidTokenIds.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
