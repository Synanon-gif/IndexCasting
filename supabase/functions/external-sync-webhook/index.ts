/**
 * Edge Function: external-sync-webhook
 *
 * Receives inbound webhook notifications from Mediaslide / Netwalk when a model
 * profile, portfolio or calendar entry changes remotely. The function verifies
 * the HMAC signature, resolves the local model by external ID, and enqueues an
 * `inbound_resync_needed` row in `external_sync_outbox`. The actual sync work
 * is performed by the existing browser-side cron (`runMediaslideCronSync` /
 * `runNetwalkCronSync`) or a future Deno worker — keeping this function thin
 * and avoiding duplicating sync logic in Deno.
 *
 * Security:
 *   - HMAC-SHA256 signature verification (per-provider shared secret).
 *   - Service-role client bypasses RLS for the outbox insert.
 *   - No JWT required (provider posts server-to-server).
 *   - No browser CORS headers — webhooks are server-to-server only.
 *
 * Deploy:
 *   supabase functions deploy external-sync-webhook --no-verify-jwt
 *
 * Required secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MEDIASLIDE_WEBHOOK_SECRET
 *   NETWALK_WEBHOOK_SECRET
 *
 * Endpoint:
 *   POST /external-sync-webhook?provider=mediaslide
 *   POST /external-sync-webhook?provider=netwalk
 *
 * Headers:
 *   X-Signature: hex-encoded HMAC-SHA256 of the raw request body using
 *                the provider-specific webhook secret.
 *
 * Payload (JSON):
 *   {
 *     "event_type": "model.updated" | "model.portfolio_changed" | "model.calendar_changed",
 *     "external_id": "<mediaslide_or_netwalk_model_id>",
 *     "occurred_at": "<ISO8601 — optional>"
 *   }
 *
 * Response:
 *   200 { ok: true, enqueued: <uuid> | null, model_id: <uuid> | null }
 *   401 invalid signature
 *   400 invalid payload
 *   404 model not linked
 *   503 missing config
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

type Provider = 'mediaslide' | 'netwalk';

type WebhookPayload = {
  event_type?: string;
  external_id?: string;
  occurred_at?: string;
};

function getEnv(name: string): string | null {
  const v = Deno.env.get(name);
  return v && v.trim().length > 0 ? v : null;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(withObservability('external-sync-webhook', async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[external-sync-webhook] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ ok: false, error: 'service_unavailable' }, 503);
  }

  // Resolve provider from query string.
  const url = new URL(req.url);
  const providerRaw = url.searchParams.get('provider')?.toLowerCase();
  if (providerRaw !== 'mediaslide' && providerRaw !== 'netwalk') {
    return jsonResponse({ ok: false, error: 'invalid_provider' }, 400);
  }
  const provider: Provider = providerRaw;

  const secret =
    provider === 'mediaslide'
      ? getEnv('MEDIASLIDE_WEBHOOK_SECRET')
      : getEnv('NETWALK_WEBHOOK_SECRET');
  if (!secret) {
    console.error(`[external-sync-webhook] missing ${provider.toUpperCase()}_WEBHOOK_SECRET`);
    return jsonResponse({ ok: false, error: 'service_unavailable' }, 503);
  }

  // Read raw body (HMAC must be computed over exact bytes).
  const rawBody = await req.text();
  if (rawBody.length === 0 || rawBody.length > 64 * 1024) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400);
  }

  // Verify signature.
  const sigHeader = req.headers.get('X-Signature') ?? req.headers.get('x-signature') ?? '';
  if (sigHeader.length === 0) {
    return jsonResponse({ ok: false, error: 'missing_signature' }, 401);
  }
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqualHex(sigHeader.toLowerCase(), expected)) {
    console.warn(`[external-sync-webhook] invalid signature provider=${provider}`);
    return jsonResponse({ ok: false, error: 'invalid_signature' }, 401);
  }

  // Parse payload.
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const externalId = (payload.external_id ?? '').trim();
  const eventType = (payload.event_type ?? 'model.updated').trim();
  if (!externalId) {
    return jsonResponse({ ok: false, error: 'missing_external_id' }, 400);
  }

  // Resolve local model + agency by external ID (service-role bypasses RLS).
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const idColumn = provider === 'mediaslide' ? 'mediaslide_sync_id' : 'netwalk_model_id';

  const { data: modelRow, error: modelErr } = await supabase
    .from('models')
    .select('id, agency_id, photo_source')
    .eq(idColumn, externalId)
    .maybeSingle();

  if (modelErr) {
    console.error('[external-sync-webhook] model lookup error', provider, externalId, modelErr);
    return jsonResponse({ ok: false, error: 'lookup_failed' }, 500);
  }

  if (!modelRow || !modelRow.agency_id) {
    // Not linked locally — acknowledge (200) so the provider does not retry.
    console.warn(
      `[external-sync-webhook] no local model for ${provider}:${externalId} — acknowledged without enqueue`,
    );
    return jsonResponse({ ok: true, enqueued: null, model_id: null });
  }

  // Enqueue inbound-resync marker. Service-role bypasses the
  // direct-INSERT lock; the table-level CHECK + idempotency index still apply.
  //
  // Idempotency key invariant (F1.2):
  //   The key MUST be deterministic for the same logical webhook event so that
  //   provider retries (network blip, 5xx, etc.) collapse onto the same row.
  //   - `occurred_at` is the canonical timestamp from the provider; we keep
  //     it as-is (no `slice` so equal ISO strings hash identically).
  //   - When the provider omits `occurred_at`, we fall back to a SHA-256 of
  //     the raw request body. This is still deterministic per delivery (same
  //     bytes → same key) and prevents a `Date.now()`-style new-key-per-retry
  //     bug that bypassed the unique partial index on
  //     (provider, idempotency_key).
  let occurredAtPart: string;
  if (typeof payload.occurred_at === 'string' && payload.occurred_at.length > 0) {
    occurredAtPart = payload.occurred_at;
  } else {
    const bodyHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
    occurredAtPart =
      'body:' +
      Array.from(new Uint8Array(bodyHashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
  }
  const idempotencyKey = `inbound:${externalId}:${eventType}:${occurredAtPart}`.slice(0, 200);

  // Pre-INSERT dedupe (cheap path: same payload already in outbox).
  const { data: existing } = await supabase
    .from('external_sync_outbox')
    .select('id')
    .eq('provider', provider)
    .eq('idempotency_key', idempotencyKey)
    .neq('status', 'failed')
    .maybeSingle();

  if (existing?.id) {
    return jsonResponse({ ok: true, enqueued: existing.id, model_id: modelRow.id, deduped: true });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('external_sync_outbox')
    .insert({
      agency_id: modelRow.agency_id,
      model_id: modelRow.id,
      provider,
      operation: 'inbound_resync_needed',
      payload: {
        event_type: eventType,
        external_id: externalId,
        occurred_at: payload.occurred_at ?? new Date().toISOString(),
      },
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // 23505 = unique violation on (provider, idempotency_key) — concurrent
    // delivery of the exact same logical event won the race. Treat as dedupe
    // success and return the existing row id, NOT 500.
    const code = (insertErr as { code?: string }).code;
    if (code === '23505') {
      const { data: dedup } = await supabase
        .from('external_sync_outbox')
        .select('id')
        .eq('provider', provider)
        .eq('idempotency_key', idempotencyKey)
        .neq('status', 'failed')
        .maybeSingle();
      return jsonResponse({
        ok: true,
        enqueued: dedup?.id ?? null,
        model_id: modelRow.id,
        deduped: true,
      });
    }
    console.error('[external-sync-webhook] outbox insert error', provider, externalId, insertErr);
    return jsonResponse({ ok: false, error: 'enqueue_failed' }, 500);
  }

  return jsonResponse({
    ok: true,
    enqueued: inserted?.id ?? null,
    model_id: modelRow.id,
  });
}));
