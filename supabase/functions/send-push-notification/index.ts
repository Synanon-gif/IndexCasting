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
  const authHeader = req.headers.get('x-webhook-secret');
  if (authHeader !== webhookSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json() as WebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (payload.type !== 'INSERT' || payload.table !== 'notifications') {
    return new Response('OK', { status: 200 });
  }

  const notification = payload.record;

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
