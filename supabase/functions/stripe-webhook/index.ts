/**
 * Edge Function: stripe-webhook
 *
 * Receives Stripe webhook events and syncs subscription state into
 * organization_subscriptions. Uses the service_role key server-side
 * (NEVER exposed to the frontend).
 *
 * Security:
 *   - Every request is verified against STRIPE_WEBHOOK_SECRET.
 *   - organization_id is resolved from Stripe metadata and validated
 *     against the database — it cannot be spoofed by the frontend.
 *   - No JWT is required from the caller; Stripe signs the request.
 *   - No CORS headers: Stripe always POSTs server-to-server. Browser-origin
 *     CORS headers are meaningless and widen the attack surface. (VULN-05 fix)
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Required secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_WEBHOOK_SECRET   (whsec_… from Stripe Dashboard)
 *   STRIPE_SECRET_KEY       (sk_live_… or sk_test_…)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

// No CORS headers: Stripe webhooks are server-to-server. Browser CORS is
// unnecessary and would widen the attack surface. (VULN-05 fix 2026-04)

// ─── Plan mapping ──────────────────────────────────────────────────────────────
// Maps Stripe price IDs to internal plan names.
// Set these as secrets: STRIPE_PRICE_AGENCY_BASIC, STRIPE_PRICE_AGENCY_PRO, etc.
// Falls back to reading the metadata.plan field set during checkout session creation.

function mapStripePriceToPlan(priceId: string, env: Record<string, string | undefined>): string | null {
  if (priceId === env['STRIPE_PRICE_AGENCY_BASIC'])      return 'agency_basic';
  if (priceId === env['STRIPE_PRICE_AGENCY_PRO'])        return 'agency_pro';
  if (priceId === env['STRIPE_PRICE_AGENCY_ENTERPRISE']) return 'agency_enterprise';
  if (priceId === env['STRIPE_PRICE_CLIENT'])            return 'client';
  return null;
}

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapStripeStatus(
  stripeStatus: Stripe.Subscription['status'],
): 'trialing' | 'active' | 'past_due' | 'canceled' {
  switch (stripeStatus) {
    case 'trialing':         return 'trialing';
    case 'active':           return 'active';
    case 'past_due':         return 'past_due';
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':           return 'canceled';
    default:                 return 'canceled';
  }
}

// ─── Upsert helper ─────────────────────────────────────────────────────────────

/**
 * CRIT-03: Subscription Linking Attack prevention.
 *
 * Before upserting, verify that the stripe_subscription_id (when provided)
 * is not already linked to a DIFFERENT organization. If it is, this is a
 * subscription reassignment attack — reject with a hard error so Stripe
 * retries and the anomaly is visible in logs/alerts.
 *
 * Legitimate scenario: the same org sends multiple events for the same
 * subscription (idempotent) → allowed.
 * Attack scenario: Stripe metadata changed to point sub to a new org →
 * blocked.
 */
async function checkSubscriptionLinking(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  stripeSubscriptionId: string | null | undefined,
): Promise<void> {
  if (!stripeSubscriptionId) return;

  const { data, error } = await supabase
    .from('organization_subscriptions')
    .select('organization_id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (error) {
    // If we can't verify, fail safe — do not allow the upsert
    console.error('[stripe-webhook] subscription_linking_check error:', error);
    throw new Error(`subscription_linking_check_failed: ${error.message}`);
  }

  if (data && data.organization_id !== orgId) {
    // CRITICAL: this stripe_subscription_id already belongs to a different org
    console.error(
      '[stripe-webhook] SUBSCRIPTION_LINKING_ATTACK: stripe_subscription_id',
      stripeSubscriptionId,
      'is already mapped to org', data.organization_id,
      '— attempted reassignment to org', orgId, 'BLOCKED',
    );
    throw new Error(
      `subscription_linking_attack: stripe_subscription_id ${stripeSubscriptionId} ` +
      `is already linked to organization ${data.organization_id}`,
    );
  }
}

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  fields: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    plan?: string | null;
    status: 'trialing' | 'active' | 'past_due' | 'canceled';
    current_period_end?: string | null;
  },
): Promise<void> {
  // CRIT-03: Verify stripe_subscription_id is not hijacked to another org
  await checkSubscriptionLinking(supabase, orgId, fields.stripe_subscription_id);

  const { error } = await supabase
    .from('organization_subscriptions')
    .upsert(
      {
        organization_id: orgId,
        ...fields,
      },
      { onConflict: 'organization_id' },
    );

  if (error) {
    console.error('[stripe-webhook] upsertSubscription error:', error);
    throw new Error(`DB upsert failed: ${error.message}`);
  }
}

// ─── Validate organization exists ─────────────────────────────────────────────

async function validateOrg(supabase: ReturnType<typeof createClient>, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  return data !== null;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Stripe webhooks are always POST — OPTIONS preflight has no meaning here.
  // Reject non-POST requests early to reduce attack surface.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const supabaseUrl       = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret     = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const stripeSecretKey   = Deno.env.get('STRIPE_SECRET_KEY');

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret || !stripeSecretKey) {
    console.error('[stripe-webhook] Missing environment configuration');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-04-10', httpClient: Stripe.createFetchHttpClient() });

  // ── Signature verification ─────────────────────────────────────────────────
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err);
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), { status: 400 });
  }

  // ── Service role client — server-side only ─────────────────────────────────
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Idempotency guard — pre-check for already-processed events ────────────
  // Phase 1: quick SELECT — return early if the event was already committed.
  // Phase 2: run business logic (upsert is inherently idempotent).
  // Phase 3: INSERT the event_id to mark it as done (after success).
  // This ordering avoids the "reserve-before-success" trap: if business logic
  // throws after an early INSERT, the event would be silently skipped on retry.
  {
    const { data: existing } = await supabase
      .from('stripe_processed_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();

    if (existing) {
      console.log('[stripe-webhook] Duplicate event ignored (already processed):', event.id);
      return new Response(JSON.stringify({ received: true, idempotent: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // NOTE: event_id is inserted AFTER business logic succeeds (see bottom of try block).
  }

  const env: Record<string, string | undefined> = {
    STRIPE_PRICE_AGENCY_BASIC:      Deno.env.get('STRIPE_PRICE_AGENCY_BASIC'),
    STRIPE_PRICE_AGENCY_PRO:        Deno.env.get('STRIPE_PRICE_AGENCY_PRO'),
    STRIPE_PRICE_AGENCY_ENTERPRISE: Deno.env.get('STRIPE_PRICE_AGENCY_ENTERPRISE'),
    STRIPE_PRICE_CLIENT:            Deno.env.get('STRIPE_PRICE_CLIENT'),
  };

  try {
    switch (event.type) {

      // ── checkout.session.completed ───────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId   = session.metadata?.organization_id;

        if (!orgId) {
          console.error('[stripe-webhook] checkout.session.completed: missing organization_id in metadata');
          // HIGH-02: Return 400 so Stripe retries and ops can investigate —
          // do NOT mark as processed since the business logic did not run.
          return new Response(
            JSON.stringify({ error: 'missing_organization_id', event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const orgExists = await validateOrg(supabase, orgId);
        if (!orgExists) {
          console.error('[stripe-webhook] checkout.session.completed: org not found:', orgId);
          return new Response(
            JSON.stringify({ error: 'organization_not_found', organization_id: orgId, event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const planFromMeta = session.metadata?.plan ?? null;
        const customerId   = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        const subId        = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;

        // Fetch full subscription to get status + period end
        let subStatus:    'trialing' | 'active' | 'past_due' | 'canceled' = 'active';
        let periodEnd:    string | null = null;

        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          subStatus = mapStripeStatus(sub.status);
          periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
        }

        await upsertSubscription(supabase, orgId, {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subId,
          plan:                   planFromMeta,
          status:                 subStatus,
          current_period_end:     periodEnd,
        });

        console.log('[stripe-webhook] checkout.session.completed: org', orgId, 'plan', planFromMeta, 'status', subStatus);
        break;
      }

      // ── customer.subscription.updated ────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub   = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organization_id;

        if (!orgId) {
          console.error('[stripe-webhook] subscription.updated: missing org metadata');
          return new Response(
            JSON.stringify({ error: 'missing_organization_id', event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const orgExists = await validateOrg(supabase, orgId);
        if (!orgExists) {
          console.error('[stripe-webhook] subscription.updated: org not found:', orgId);
          return new Response(
            JSON.stringify({ error: 'organization_not_found', organization_id: orgId, event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Resolve plan from price ID or metadata
        const priceId    = sub.items?.data?.[0]?.price?.id ?? '';
        const planFromPrice = mapStripePriceToPlan(priceId, env);
        const plan       = planFromPrice ?? sub.metadata?.plan ?? null;
        const status     = mapStripeStatus(sub.status);
        const periodEnd  = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;

        await upsertSubscription(supabase, orgId, {
          stripe_customer_id:     customerId,
          stripe_subscription_id: sub.id,
          plan,
          status,
          current_period_end: periodEnd,
        });

        // Sync swipe limit when plan changes
        if (plan) {
          const planLimits: Record<string, number> = {
            agency_basic:      10,
            agency_pro:        50,
            agency_enterprise: 150,
          };
          const newLimit = planLimits[plan];
          if (newLimit !== undefined) {
            await supabase
              .from('agency_usage_limits')
              .update({ daily_swipe_limit: newLimit, updated_at: new Date().toISOString() })
              .eq('organization_id', orgId);
          }
        }

        console.log('[stripe-webhook] subscription.updated: org', orgId, 'plan', plan, 'status', status);
        break;
      }

      // ── customer.subscription.deleted ────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub   = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organization_id;

        if (!orgId) {
          console.error('[stripe-webhook] subscription.deleted: missing org metadata');
          return new Response(
            JSON.stringify({ error: 'missing_organization_id', event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const orgExists = await validateOrg(supabase, orgId);
        if (!orgExists) {
          console.error('[stripe-webhook] subscription.deleted: org not found:', orgId);
          return new Response(
            JSON.stringify({ error: 'organization_not_found', organization_id: orgId, event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;

        await upsertSubscription(supabase, orgId, {
          stripe_customer_id:     customerId,
          stripe_subscription_id: sub.id,
          status:                 'canceled',
          current_period_end:     null,
        });

        console.log('[stripe-webhook] subscription.deleted: org', orgId);
        break;
      }

      // ── invoice.paid ──────────────────────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId   = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id ?? null;

        if (!subId) {
          console.warn('[stripe-webhook] invoice.paid: no subscription ID, skipping');
          break;
        }

        const sub   = await stripe.subscriptions.retrieve(subId);
        const orgId = sub.metadata?.organization_id;

        if (!orgId) {
          console.error('[stripe-webhook] invoice.paid: missing org metadata on subscription', subId);
          return new Response(
            JSON.stringify({ error: 'missing_organization_id', subscription_id: subId, event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const orgExists = await validateOrg(supabase, orgId);
        if (!orgExists) {
          console.error('[stripe-webhook] invoice.paid: org not found:', orgId);
          return new Response(
            JSON.stringify({ error: 'organization_not_found', organization_id: orgId, event_id: event.id }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;

        await upsertSubscription(supabase, orgId, {
          stripe_customer_id:     customerId,
          stripe_subscription_id: sub.id,
          status:                 'active',
          current_period_end:     periodEnd,
        });

        console.log('[stripe-webhook] invoice.paid: org', orgId, 'renewed until', periodEnd);
        break;
      }

      default:
        console.log('[stripe-webhook] Unhandled event type:', event.type);
    }

    // Phase 3: mark event as processed — only reached when business logic succeeded.
    // 23505 = concurrent duplicate insert (race); safe to ignore.
    // Any other error → return 500 so Stripe retries. Without this, a failed
    // insert would cause the same event to run business logic again on retry.
    // (MED-02 fix)
    const { error: markError } = await supabase
      .from('stripe_processed_events')
      .insert({ event_id: event.id });
    if (markError && markError.code !== '23505') {
      console.error('[stripe-webhook] Failed to mark event as processed — forcing retry:', markError);
      return new Response(
        JSON.stringify({ error: 'failed_to_mark_processed', event_id: event.id }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
