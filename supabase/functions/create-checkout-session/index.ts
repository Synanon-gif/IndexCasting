/**
 * Edge Function: create-checkout-session
 *
 * Creates a Stripe Checkout session for an authenticated organization.
 * The organization_id is resolved server-side from the caller's JWT —
 * the frontend CANNOT inject a different organization_id.
 *
 * Security:
 *   - JWT is required and verified via Supabase auth.
 *   - organization_id is resolved from auth.uid() → organization_members.
 *   - Stripe API key is server-side only.
 *   - success_url / cancel_url are validated against an origin allowlist to
 *     prevent open-redirect attacks (VULN-02 fix 2026-04).
 *
 * Deploy:
 *   supabase functions deploy create-checkout-session
 *
 * Required secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_AGENCY_BASIC         (price_…)
 *   STRIPE_PRICE_AGENCY_PRO           (price_…)
 *   STRIPE_PRICE_AGENCY_ENTERPRISE    (price_…)
 *   STRIPE_PRICE_CLIENT               (price_…)
 *   APP_URL                           (https://your-app.com — for redirect URLs)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PlanType = 'agency_basic' | 'agency_pro' | 'agency_enterprise' | 'client';

// ── URL allowlist helpers (VULN-02 fix) ────────────────────────────────────────
// success_url / cancel_url must originate from an approved domain.
// The list is built from APP_URL at runtime so staging/prod environments are
// automatically covered without hardcoding extra entries.

function buildAllowedOrigins(appUrl: string): string[] {
  const origins = new Set<string>();
  // Always include the canonical production domain.
  origins.add('https://indexcasting.com');
  try {
    origins.add(new URL(appUrl).origin);
  } catch {
    // appUrl is malformed — skip; production fallback above is still active.
  }
  return [...origins];
}

function isAllowedRedirectUrl(url: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(url);
    // Only HTTPS redirects are accepted.
    if (parsed.protocol !== 'https:') return false;
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

interface CheckoutRequest {
  plan: PlanType;
  success_url?: string;
  cancel_url?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl     = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey         = Deno.env.get('SUPABASE_ANON_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const appUrl          = Deno.env.get('APP_URL') ?? 'https://indexcasting.com';

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !stripeSecretKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server misconfiguration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Verify caller JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Parse + validate request body ─────────────────────────────────────────
  let body: CheckoutRequest;
  try {
    body = await req.json() as CheckoutRequest;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const validPlans: PlanType[] = ['agency_basic', 'agency_pro', 'agency_enterprise', 'client'];
  if (!body.plan || !validPlans.includes(body.plan)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid or missing plan' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Resolve organization_id server-side from auth.uid() ────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ORDER BY created_at ASC: deterministic org selection when a user somehow has
  // multiple memberships. Consistent with can_access_platform() (VULN-M6 fix).
  const { data: memberRow, error: memberError } = await adminClient
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memberError || !memberRow) {
    console.error('[create-checkout-session] No org membership for user:', user.id, memberError);
    return new Response(
      JSON.stringify({ ok: false, error: 'No organization found for this user' }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const orgId = memberRow.organization_id as string;

  // Only org owners may initiate checkout
  if (memberRow.role !== 'owner') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Only the organization owner can manage billing' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Resolve Stripe price ID ────────────────────────────────────────────────
  const priceEnvMap: Record<PlanType, string> = {
    agency_basic:      'STRIPE_PRICE_AGENCY_BASIC',
    agency_pro:        'STRIPE_PRICE_AGENCY_PRO',
    agency_enterprise: 'STRIPE_PRICE_AGENCY_ENTERPRISE',
    client:            'STRIPE_PRICE_CLIENT',
  };

  const priceId = Deno.env.get(priceEnvMap[body.plan]);
  if (!priceId) {
    console.error('[create-checkout-session] Missing price env for plan:', body.plan);
    return new Response(
      JSON.stringify({ ok: false, error: 'Pricing not configured for this plan' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Look up or reuse existing Stripe customer ──────────────────────────────
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const { data: subRow } = await adminClient
    .from('organization_subscriptions')
    .select('stripe_customer_id')
    .eq('organization_id', orgId)
    .maybeSingle();

  let customerId: string | undefined = subRow?.stripe_customer_id ?? undefined;

  if (!customerId) {
    // Fetch org name + owner email for a nicer Stripe customer record
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, display_name')
      .eq('id', user.id)
      .maybeSingle();

    const customer = await stripe.customers.create({
      email:    profile?.email ?? user.email ?? undefined,
      name:     orgRow?.name ?? undefined,
      metadata: { organization_id: orgId, user_id: user.id },
    });
    customerId = customer.id;

    // Persist so future checkouts reuse the same customer
    await adminClient
      .from('organization_subscriptions')
      .upsert(
        { organization_id: orgId, stripe_customer_id: customerId, status: 'trialing' },
        { onConflict: 'organization_id' },
      );
  }

  // ── Validate and resolve redirect URLs (VULN-02 fix) ─────────────────────
  const allowedOrigins = buildAllowedOrigins(appUrl);

  if (body.success_url && !isAllowedRedirectUrl(body.success_url, allowedOrigins)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid success_url: origin not in allowlist' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  if (body.cancel_url && !isAllowedRedirectUrl(body.cancel_url, allowedOrigins)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid cancel_url: origin not in allowlist' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Create checkout session ────────────────────────────────────────────────
  const successUrl = body.success_url ?? `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = body.cancel_url  ?? `${appUrl}/billing/cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode:               'subscription',
      customer:           customerId,
      line_items:         [{ price: priceId, quantity: 1 }],
      success_url:        successUrl,
      cancel_url:         cancelUrl,
      subscription_data: {
        metadata: {
          organization_id: orgId,
          plan:            body.plan,
        },
      },
      metadata: {
        organization_id: orgId,
        plan:            body.plan,
      },
      allow_promotion_codes: true,
    });

    console.log('[create-checkout-session] Created session for org', orgId, 'plan', body.plan);

    return new Response(
      JSON.stringify({ ok: true, checkout_url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[create-checkout-session] Stripe error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to create checkout session' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
