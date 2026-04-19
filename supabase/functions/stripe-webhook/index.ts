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
import { withObservability } from '../_shared/logger.ts';
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

// ─── B2B invoice helper (public.invoices) ─────────────────────────────────────
//
// B2B invoices created by send-invoice-via-stripe carry metadata.invoice_id
// (UUID into public.invoices). When Stripe emits invoice.* events for these,
// we mirror the lifecycle into public.invoices.status without touching the
// subscription paywall path.

const B2B_INVOICE_STATUS_MAP: Record<string, string> = {
  'invoice.finalized':           'sent',
  'invoice.sent':                'sent',
  'invoice.paid':                'paid',
  'invoice.payment_succeeded':   'paid',
  'invoice.payment_failed':      'overdue',
  'invoice.voided':              'void',
  'invoice.marked_uncollectible':'uncollectible',
};

async function tryHandleB2bInvoiceEvent(
  supabase: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<boolean> {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  const localInvoiceId = stripeInvoice.metadata?.invoice_id ?? null;

  // Not a B2B invoice — fall through to existing subscription handler.
  if (!localInvoiceId) return false;

  const newStatus = B2B_INVOICE_STATUS_MAP[event.type];
  if (!newStatus) {
    // B2B invoice but we don't care about this event type.
    console.log('[stripe-webhook] B2B invoice event ignored:', event.type, 'invoice_id:', localInvoiceId);
    return true;
  }

  // Look up local invoice (defense: ensure it exists and Stripe ID matches if set).
  const { data: localInvoice, error: lookupErr } = await supabase
    .from('invoices')
    .select('id, status, stripe_invoice_id, organization_id')
    .eq('id', localInvoiceId)
    .maybeSingle();

  if (lookupErr || !localInvoice) {
    console.error('[stripe-webhook] B2B invoice not found in DB:', localInvoiceId, lookupErr);
    // Treat as handled (don't fall through to subscription path); idempotent skip.
    return true;
  }

  // Defense: if Stripe ID is set in DB and disagrees with the event, something is wrong.
  if (localInvoice.stripe_invoice_id && localInvoice.stripe_invoice_id !== stripeInvoice.id) {
    console.error(
      '[stripe-webhook] B2B invoice stripe_invoice_id mismatch:',
      'DB has', localInvoice.stripe_invoice_id, 'event has', stripeInvoice.id,
    );
    return true;
  }

  // Build update payload — status transitions only forward (never re-open paid/void).
  const TERMINAL_STATES = new Set(['paid', 'void', 'uncollectible']);
  const update: Record<string, unknown> = {};

  if (TERMINAL_STATES.has(localInvoice.status as string)) {
    console.log('[stripe-webhook] B2B invoice already terminal, skipping status update:', localInvoice.id, localInvoice.status);
  } else {
    update.status = newStatus;
  }

  // Always refresh hosted/PDF URLs and Stripe ID on the way through.
  update.stripe_invoice_id   = stripeInvoice.id;
  update.stripe_hosted_url   = stripeInvoice.hosted_invoice_url ?? null;
  update.stripe_pdf_url      = stripeInvoice.invoice_pdf ?? null;
  if (typeof stripeInvoice.payment_intent === 'string') {
    update.stripe_payment_intent_id = stripeInvoice.payment_intent;
  }
  if (newStatus === 'paid') update.paid_at = new Date().toISOString();

  // 20261123 — Stripe failure tracking (Phase C.3).
  // The canonical `status` enum has no `payment_failed` value (intentionally
  // — it would conflict with the calendar-based `overdue` lifecycle). Instead
  // we mirror Stripe's payment_failed signal onto two dedicated columns so
  // the Smart Attention layer (Phase C.1) can surface a CRITICAL
  // `invoice_payment_failed` signal independent of overdue.
  //
  // Idempotent: invoice.payment_failed → set timestamp + reason
  //              invoice.paid / invoice.voided → clear both
  //              other events → leave untouched.
  if (event.type === 'invoice.payment_failed') {
    update.last_stripe_failure_at = new Date().toISOString();
    const failureReason =
      (stripeInvoice as unknown as {
        last_finalization_error?: { message?: string | null } | null;
      }).last_finalization_error?.message
        ?? (typeof (stripeInvoice as unknown as { failure_message?: string | null }).failure_message === 'string'
            ? (stripeInvoice as unknown as { failure_message?: string | null }).failure_message
            : null);
    update.last_stripe_failure_reason = failureReason ?? 'Stripe reported invoice.payment_failed (no detail)';
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded' || event.type === 'invoice.voided') {
    update.last_stripe_failure_at = null;
    update.last_stripe_failure_reason = null;
  }

  // F2.6 — Tax / amount sync from Stripe (Stripe is source of truth after
  // finalize). With STRIPE_TAX_ENABLED=true Stripe re-computes tax from the
  // recipient address; the values in our DB at draft time were only an
  // estimate. Mirror the authoritative figures so our UI/PDF/audit reflect
  // what the customer actually owes / paid.
  //
  // Idempotent: Stripe locks subtotal/tax/total at finalize, so re-emitted
  // events carry the same values. Currency is normalized to upper-case to
  // match the rest of our schema.
  if (typeof stripeInvoice.subtotal === 'number') {
    update.subtotal_amount_cents = stripeInvoice.subtotal;
  }
  if (typeof stripeInvoice.tax === 'number' && stripeInvoice.tax !== null) {
    update.tax_amount_cents = stripeInvoice.tax;
  } else if (stripeInvoice.tax === null) {
    update.tax_amount_cents = 0;
  }
  if (typeof stripeInvoice.total === 'number') {
    update.total_amount_cents = stripeInvoice.total;
  }
  if (typeof stripeInvoice.currency === 'string' && stripeInvoice.currency.length > 0) {
    update.currency = stripeInvoice.currency.toUpperCase();
  }
  // Single tax rate → mirror percent (best-effort; multi-rate split-charges
  // are rare for B2B and are intentionally left untouched so we don't
  // collapse them to a misleading single number).
  const totalTaxAmounts = (stripeInvoice as unknown as {
    total_tax_amounts?: Array<{ tax_rate?: string | { percentage?: number | null } | null }>;
  }).total_tax_amounts;
  if (Array.isArray(totalTaxAmounts) && totalTaxAmounts.length === 1) {
    const taxRateRef = totalTaxAmounts[0]?.tax_rate;
    if (taxRateRef && typeof taxRateRef === 'object' && typeof taxRateRef.percentage === 'number') {
      update.tax_rate_percent = taxRateRef.percentage;
    }
  }

  const { error: updErr } = await supabase
    .from('invoices')
    .update(update)
    .eq('id', localInvoice.id);

  if (updErr) {
    console.error('[stripe-webhook] B2B invoice update failed:', updErr);
    throw new Error(`b2b_invoice_update_failed: ${updErr.message}`);
  }

  // Audit event
  await supabase.from('invoice_events').insert({
    invoice_id: localInvoice.id,
    event_type: event.type,
    actor_role: 'stripe_webhook',
    payload: {
      stripe_event_id: event.id,
      stripe_invoice_id: stripeInvoice.id,
      status_before: localInvoice.status,
      status_after: update.status ?? localInvoice.status,
      amount_paid: stripeInvoice.amount_paid,
      amount_due: stripeInvoice.amount_due,
      // F2.6 — record the Stripe-authoritative figures we mirrored.
      stripe_subtotal_cents: stripeInvoice.subtotal ?? null,
      stripe_tax_cents: stripeInvoice.tax ?? null,
      stripe_total_cents: stripeInvoice.total ?? null,
      stripe_currency: stripeInvoice.currency ?? null,
      mirrored_tax_rate_percent: (update.tax_rate_percent as number | undefined) ?? null,
      // 20261123 — record Stripe failure mirroring for audit / replay.
      stripe_failure_at: (update.last_stripe_failure_at as string | null | undefined) ?? null,
      stripe_failure_reason: (update.last_stripe_failure_reason as string | null | undefined) ?? null,
    },
  });

  console.log('[stripe-webhook] B2B invoice updated:', localInvoice.id, '→', update.status ?? localInvoice.status);
  return true;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(withObservability('stripe-webhook', async (req: Request) => {
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
    // ── B2B invoice dispatch (public.invoices) ──────────────────────────────
    // Try to match B2B invoice events first. Returns true if event was handled
    // as a B2B invoice (whether or not we updated anything). Returns false to
    // fall through to the existing subscription paywall handlers.
    if (
      event.type === 'invoice.finalized' ||
      event.type === 'invoice.sent' ||
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_succeeded' ||
      event.type === 'invoice.payment_failed' ||
      event.type === 'invoice.voided' ||
      event.type === 'invoice.marked_uncollectible'
    ) {
      const handled = await tryHandleB2bInvoiceEvent(supabase, event);
      if (handled) {
        // Mark processed and return early (do NOT fall through to subscription path).
        const { error: markErr } = await supabase
          .from('stripe_processed_events')
          .insert({ event_id: event.id });
        if (markErr && markErr.code !== '23505') {
          console.error('[stripe-webhook] Failed to mark B2B event processed:', markErr);
          return new Response(
            JSON.stringify({ error: 'failed_to_mark_processed', event_id: event.id }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ received: true, b2b_invoice: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Not a B2B invoice → fall through to subscription handlers below.
    }

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
}));
