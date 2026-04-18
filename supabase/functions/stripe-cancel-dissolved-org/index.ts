/**
 * Edge Function: stripe-cancel-dissolved-org
 *
 * Cancels the Stripe subscription of an organization that was just
 * soft-dissolved by `public.dissolve_organization` (Migration A,
 * 20260418_dissolve_organization_v2_softdissolve.sql).
 *
 * Flow:
 *   1. Frontend calls `dissolve_organization` (RPC).
 *   2. RPC returns { ok, organization_id, stripe_customer_id, stripe_subscription_id, ... }.
 *   3. Frontend invokes this Edge function with { organization_id }.
 *   4. Function verifies the caller WAS the owner of this org (via auth + recently
 *      dissolved + dissolved_by = caller).
 *   5. Function calls Stripe: subscriptions.cancel(stripe_subscription_id).
 *   6. Function persists `status='canceled'` (idempotent — RPC already did it locally).
 *
 * Fail-tolerant: any Stripe error returns { ok: false, error } but does NOT roll
 * back the soft-dissolve. The local subscription row is already `canceled`. Ops
 * can reconcile via Stripe dashboard or by re-invoking this function.
 *
 * Security:
 *   • JWT required.
 *   • Caller must be the user who triggered dissolve (organizations.dissolved_by).
 *   • organization_id is read from request body but VALIDATED against the
 *     authenticated user — no cross-org cancel.
 *
 * Required secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   STRIPE_SECRET_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const ALWAYS_ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALWAYS_ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALWAYS_ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

interface CancelRequest {
  organization_id: string;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl     = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey         = Deno.env.get('SUPABASE_ANON_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !stripeSecretKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'server_misconfiguration' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Verify caller JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ ok: false, error: 'missing_authorization' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ ok: false, error: 'unauthorized' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: CancelRequest;
  try {
    body = await req.json() as CancelRequest;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid_json' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  if (!body.organization_id || typeof body.organization_id !== 'string') {
    return new Response(
      JSON.stringify({ ok: false, error: 'missing_organization_id' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Validate caller WAS the owner who dissolved this org ──────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgRow, error: orgErr } = await adminClient
    .from('organizations')
    .select('id, dissolved_at, dissolved_by')
    .eq('id', body.organization_id)
    .maybeSingle();

  if (orgErr || !orgRow) {
    return new Response(
      JSON.stringify({ ok: false, error: 'organization_not_found' }),
      { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  if (orgRow.dissolved_at == null) {
    return new Response(
      JSON.stringify({ ok: false, error: 'organization_not_dissolved' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  if (orgRow.dissolved_by !== user.id) {
    // Allow admin override.
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.is_admin) {
      return new Response(
        JSON.stringify({ ok: false, error: 'forbidden_not_dissolver' }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  }

  // ── Fetch Stripe IDs ───────────────────────────────────────────────────────
  const { data: subRow } = await adminClient
    .from('organization_subscriptions')
    .select('stripe_subscription_id, stripe_customer_id, status')
    .eq('organization_id', body.organization_id)
    .maybeSingle();

  if (!subRow?.stripe_subscription_id) {
    // Nothing to cancel on Stripe side. Make sure local status is canceled.
    await adminClient
      .from('organization_subscriptions')
      .update({ status: 'canceled' })
      .eq('organization_id', body.organization_id);

    return new Response(
      JSON.stringify({ ok: true, note: 'no_stripe_subscription_to_cancel' }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Cancel via Stripe ──────────────────────────────────────────────────────
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const cancelled = await stripe.subscriptions.cancel(subRow.stripe_subscription_id, {
      invoice_now: false,
      prorate: false,
    });

    await adminClient
      .from('organization_subscriptions')
      .update({ status: 'canceled' })
      .eq('organization_id', body.organization_id);

    console.log(
      '[stripe-cancel-dissolved-org] Cancelled',
      subRow.stripe_subscription_id,
      'for org',
      body.organization_id,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        organization_id: body.organization_id,
        stripe_subscription_id: subRow.stripe_subscription_id,
        stripe_status: cancelled.status,
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stripe-cancel-dissolved-org] Stripe error:', msg);

    // Local row is already canceled by the dissolve RPC. Surface the error
    // so the frontend can show a non-blocking warning. The dissolve itself
    // remains valid.
    return new Response(
      JSON.stringify({
        ok: false,
        organization_id: body.organization_id,
        stripe_subscription_id: subRow.stripe_subscription_id,
        error: 'stripe_cancel_failed',
        message: msg,
      }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
