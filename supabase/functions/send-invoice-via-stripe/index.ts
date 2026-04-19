/**
 * Edge Function: send-invoice-via-stripe
 *
 * Sends a DRAFT invoice via Stripe Invoicing.
 *
 * State machine (F2.5 split-brain-safe):
 *   draft         (initial)
 *     │  pre-lock UPDATE (invoice_number + snapshots + sent_by + sent_at)
 *     ▼
 *   pending_send  (number reserved, snapshots frozen, NO Stripe call yet)
 *     │  Stripe create + items + finalize + send (all idempotent)
 *     │  final UPDATE (stripe_invoice_id, hosted_url, pdf_url, payment_intent)
 *     ▼
 *   sent          (terminal for this function)
 *
 * Re-entry rules (when caller retries after partial failure):
 *   - status='draft'        → full pipeline.
 *   - status='pending_send' AND stripe_invoice_id IS NULL
 *                           → re-run Stripe with same invoice.id-derived
 *                             idempotency keys (Stripe dedups), then final
 *                             UPDATE. invoice_number is re-used (already set).
 *   - status='pending_send' AND stripe_invoice_id IS NOT NULL
 *                           → split-brain recovery: skip Stripe, just final
 *                             UPDATE to mark 'sent'. The Stripe-side already
 *                             succeeded last time; only the DB write failed.
 *   - status='sent' / 'paid' / etc. → 409 conflict.
 *
 * Idempotency:
 *   - All Stripe mutating calls carry an idempotency key derived from
 *     invoice.id (or item.id / recipient_org_id). Stripe deduplicates within
 *     24h, so retries within that window never double-create.
 *   - Local DB pre-lock binds invoice_number to this invoice row before
 *     Stripe is contacted. A failure between pre-lock and final UPDATE
 *     leaves a recoverable 'pending_send' row, never a silent duplicate.
 *
 * Invariants:
 *   - I-PAY-1: payment authority is Stripe; we only mirror state from webhooks.
 *   - I-PAY-3: owner-only; enforced server-side, not just RLS.
 *   - I-PAY-9: no custodial funds — Stripe collects directly from payer.
 *   - F2.3: billing_profile_snapshot / recipient_billing_snapshot / invoice_number
 *           become immutable once status leaves 'draft' (see freeze trigger).
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_TAX_ENABLED (optional, default 'false')
 *
 * Deploy:
 *   supabase functions deploy send-invoice-via-stripe
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
  const allowOrigin = ALWAYS_ALLOWED_ORIGINS.includes(origin) ? origin : ALWAYS_ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

interface SendInvoiceRequest {
  invoice_id: string;
}

interface BillingProfileRow {
  id: string;
  organization_id: string;
  label: string | null;
  billing_name: string | null;
  billing_address_1: string | null;
  billing_address_2: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  billing_state: string | null;
  billing_country: string | null;
  billing_email: string | null;
  vat_id: string | null;
  tax_id: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const stripeTaxEnabled = (Deno.env.get('STRIPE_TAX_ENABLED') ?? 'false').toLowerCase() === 'true';

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !stripeSecretKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Verify caller JWT ─────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: SendInvoiceRequest;
  try {
    body = (await req.json()) as SendInvoiceRequest;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!body.invoice_id || typeof body.invoice_id !== 'string') {
    return new Response(JSON.stringify({ ok: false, error: 'Missing invoice_id' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Admin Supabase client for RLS-bypassing reads / writes ────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Load invoice + verify ownership + state ───────────────────────────────
  const { data: invoice, error: invErr } = await adminClient
    .from('invoices')
    .select(
      'id, organization_id, recipient_organization_id, invoice_type, status, currency, ' +
        'subtotal_amount_cents, tax_amount_cents, total_amount_cents, tax_rate_percent, ' +
        'tax_mode, reverse_charge_applied, due_date, notes, source_option_request_id, ' +
        'invoice_number, stripe_invoice_id, stripe_hosted_url, stripe_pdf_url, ' +
        'billing_profile_snapshot, recipient_billing_snapshot',
    )
    .eq('id', body.invoice_id)
    .maybeSingle();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ ok: false, error: 'Invoice not found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // F2.5: accept draft (full pipeline) and pending_send (re-entry / recovery).
  if (invoice.status !== 'draft' && invoice.status !== 'pending_send') {
    return new Response(
      JSON.stringify({ ok: false, error: `Invoice cannot be sent: status='${invoice.status}'` }),
      { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Owner check (issuer org)
  const { data: issuerOrg } = await adminClient
    .from('organizations')
    .select('id, name, owner_id')
    .eq('id', invoice.organization_id)
    .maybeSingle();

  if (!issuerOrg || issuerOrg.owner_id !== user.id) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Only the issuer organization owner can send invoices' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  if (!invoice.recipient_organization_id) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invoice has no recipient organization' }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Load line items ───────────────────────────────────────────────────────
  const { data: lineItems, error: lineErr } = await adminClient
    .from('invoice_line_items')
    .select('id, description, quantity, unit_amount_cents, total_amount_cents, currency, position')
    .eq('invoice_id', invoice.id)
    .order('position', { ascending: true });

  if (lineErr || !lineItems || lineItems.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invoice has no line items — add at least one before sending' }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Resolve issuer + recipient billing profiles (default → first) ─────────
  const { data: issuerProfiles } = await adminClient
    .from('organization_billing_profiles')
    .select(
      'id, organization_id, label, billing_name, billing_address_1, billing_address_2, billing_city, ' +
        'billing_postal_code, billing_state, billing_country, billing_email, vat_id, tax_id, iban, bic, bank_name, is_default',
    )
    .eq('organization_id', invoice.organization_id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  const issuerProfile: BillingProfileRow | null = issuerProfiles?.[0] ?? null;

  if (!issuerProfile || !issuerProfile.billing_name) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'Issuer organization has no complete billing profile (billing_name required). ' +
          'Add a billing profile in Settings → Billing first.',
      }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const { data: recipientProfiles } = await adminClient
    .from('organization_billing_profiles')
    .select(
      'id, organization_id, label, billing_name, billing_address_1, billing_address_2, billing_city, ' +
        'billing_postal_code, billing_state, billing_country, billing_email, vat_id, tax_id, iban, bic, bank_name, is_default',
    )
    .eq('organization_id', invoice.recipient_organization_id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  const recipientProfile: BillingProfileRow | null = recipientProfiles?.[0] ?? null;

  const { data: recipientOrg } = await adminClient
    .from('organizations')
    .select('id, name')
    .eq('id', invoice.recipient_organization_id)
    .maybeSingle();

  const recipientEmail = recipientProfile?.billing_email ?? null;
  const recipientName = recipientProfile?.billing_name ?? recipientOrg?.name ?? 'Customer';

  if (!recipientEmail) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'Recipient organization has no billing email. Ask them to set one in their billing profile.',
      }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Reserve invoice_number (only on first attempt) ────────────────────────
  let invoiceNumber: string;
  if (invoice.invoice_number) {
    // Re-entry: number was already reserved + bound to this invoice row.
    invoiceNumber = invoice.invoice_number;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: numberRes, error: numberErr } = await userClient.rpc('next_invoice_number', {
      p_organization_id: invoice.organization_id,
      p_invoice_type: invoice.invoice_type,
      p_year: null,
    });

    if (numberErr || !numberRes) {
      console.error('[send-invoice-via-stripe] next_invoice_number failed:', numberErr);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to reserve invoice number' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    invoiceNumber = String(numberRes);
  }

  // ── F2.5 Pre-Lock: bind invoice_number + freeze snapshots + flip to
  //    pending_send BEFORE any Stripe API call. This guarantees that, if
  //    the function dies between Stripe success and the final UPDATE, we
  //    can recover deterministically: the row already carries the number
  //    and snapshots, and re-entry will pick up the same Stripe invoice
  //    via idempotency keys.
  //
  //    Skip if we are re-entering (status already pending_send).
  if (invoice.status === 'draft') {
    const billingSnapshot = buildIssuerSnapshot(issuerProfile);
    const recipientSnapshot = buildRecipientSnapshot(recipientProfile, recipientName, recipientEmail);

    const { error: lockErr, data: lockedRow } = await adminClient
      .from('invoices')
      .update({
        status: 'pending_send',
        invoice_number: invoiceNumber,
        billing_profile_snapshot: billingSnapshot,
        recipient_billing_snapshot: recipientSnapshot,
        sent_at: new Date().toISOString(),
        sent_by: user.id,
      })
      .eq('id', invoice.id)
      .eq('status', 'draft') // optimistic CAS — bail if someone else moved us
      .select('id')
      .maybeSingle();

    if (lockErr || !lockedRow) {
      console.error('[send-invoice-via-stripe] pre-lock UPDATE failed:', lockErr);
      // Audit so admin can reconcile (number was reserved but not bound).
      await adminClient.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: 'send_prelock_failed',
        actor_user_id: user.id,
        actor_role: 'owner',
        payload: {
          reserved_invoice_number: invoiceNumber,
          db_error: lockErr?.message ?? 'no row updated (status changed concurrently?)',
        },
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to lock invoice for sending — please retry. If this persists, contact support.',
        }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  }

  // ── Stripe customer (idempotent) ──────────────────────────────────────────
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  let recipientCustomerId: string | undefined;

  const { data: cachedCustomer } = await adminClient
    .from('organization_stripe_customers')
    .select('stripe_customer_id')
    .eq('organization_id', invoice.recipient_organization_id)
    .maybeSingle();

  if (cachedCustomer?.stripe_customer_id) {
    recipientCustomerId = cachedCustomer.stripe_customer_id;
  } else {
    const { data: recipientSubRow } = await adminClient
      .from('organization_subscriptions')
      .select('stripe_customer_id')
      .eq('organization_id', invoice.recipient_organization_id)
      .maybeSingle();
    if (recipientSubRow?.stripe_customer_id) {
      recipientCustomerId = recipientSubRow.stripe_customer_id;
    }
  }

  if (!recipientCustomerId) {
    try {
      const customer = await stripe.customers.create(
        {
          email: recipientEmail,
          name: recipientName,
          address: recipientProfile
            ? {
                line1: recipientProfile.billing_address_1 ?? undefined,
                line2: recipientProfile.billing_address_2 ?? undefined,
                city: recipientProfile.billing_city ?? undefined,
                postal_code: recipientProfile.billing_postal_code ?? undefined,
                state: recipientProfile.billing_state ?? undefined,
                country: recipientProfile.billing_country ?? undefined,
              }
            : undefined,
          metadata: {
            organization_id: invoice.recipient_organization_id,
            purpose: 'invoice_recipient',
          },
        },
        { idempotencyKey: `recipient-org:${invoice.recipient_organization_id}:invoice_recipient` },
      );
      recipientCustomerId = customer.id;

      await adminClient.from('organization_stripe_customers').upsert(
        {
          organization_id: invoice.recipient_organization_id,
          stripe_customer_id: recipientCustomerId,
          purpose: 'invoice_recipient',
        },
        { onConflict: 'organization_id', ignoreDuplicates: false },
      );
    } catch (err) {
      console.error('[send-invoice-via-stripe] stripe.customers.create failed:', err);
      const message = err instanceof Error ? err.message : 'Stripe customer creation failed';
      return new Response(JSON.stringify({ ok: false, error: `Stripe error: ${message}` }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Tax handling ──────────────────────────────────────────────────────────
  const manualTaxRatePercent = !stripeTaxEnabled
    && !invoice.reverse_charge_applied
    && Number(invoice.tax_rate_percent ?? 0) > 0
    ? Number(invoice.tax_rate_percent)
    : 0;

  let manualTaxRateId: string | null = null;
  if (manualTaxRatePercent > 0) {
    try {
      const taxRate = await stripe.taxRates.create(
        {
          display_name: `VAT ${manualTaxRatePercent}%`,
          percentage: manualTaxRatePercent,
          inclusive: false,
          country: issuerProfile.billing_country ?? undefined,
          metadata: {
            invoice_id: invoice.id,
            organization_id: invoice.organization_id,
            source: 'send-invoice-via-stripe',
          },
        },
        { idempotencyKey: `inv:${invoice.id}:taxrate:${manualTaxRatePercent}` },
      );
      manualTaxRateId = taxRate.id;
    } catch (err) {
      console.warn('[send-invoice-via-stripe] tax rate creation failed; sending without tax:', err);
    }
  }

  // ── Create / re-attach Stripe invoice (all idempotent) ────────────────────
  let stripeInvoice: Stripe.Invoice;
  try {
    if (invoice.stripe_invoice_id) {
      // Split-brain recovery: Stripe-side already ran last time, but the
      // final DB UPDATE failed. Re-fetch and skip create/items/finalize/send.
      stripeInvoice = await stripe.invoices.retrieve(invoice.stripe_invoice_id);
    } else {
      stripeInvoice = await stripe.invoices.create(
        {
          customer: recipientCustomerId,
          collection_method: 'send_invoice',
          days_until_due: invoice.due_date
            ? Math.max(
                1,
                Math.ceil(
                  (new Date(invoice.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                ),
              )
            : 30,
          currency: (invoice.currency ?? 'EUR').toLowerCase(),
          auto_advance: false,
          automatic_tax: stripeTaxEnabled ? { enabled: true } : undefined,
          default_tax_rates: manualTaxRateId ? [manualTaxRateId] : undefined,
          number: invoiceNumber,
          description: invoice.reverse_charge_applied
            ? `${invoice.notes ?? ''}\n\nReverse charge — VAT to be accounted for by the recipient.`.trim()
            : invoice.notes ?? undefined,
          metadata: {
            invoice_id: invoice.id,
            organization_id: invoice.organization_id,
            recipient_organization_id: invoice.recipient_organization_id,
            invoice_type: invoice.invoice_type,
            source_option_request_id: invoice.source_option_request_id ?? '',
            tax_mode: stripeTaxEnabled ? 'stripe_tax' : manualTaxRateId ? 'manual' : 'none',
            reverse_charge: invoice.reverse_charge_applied ? 'true' : 'false',
          },
        },
        { idempotencyKey: `inv:${invoice.id}:create` },
      );

      for (const item of lineItems) {
        await stripe.invoiceItems.create(
          {
            customer: recipientCustomerId,
            invoice: stripeInvoice.id,
            currency: (item.currency ?? invoice.currency ?? 'EUR').toLowerCase(),
            description: item.description,
            quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1))),
            unit_amount: Number(item.unit_amount_cents ?? 0),
          },
          { idempotencyKey: `inv:${invoice.id}:item:${item.id}` },
        );
      }

      stripeInvoice = await stripe.invoices.finalizeInvoice(
        stripeInvoice.id,
        { auto_advance: false },
        { idempotencyKey: `inv:${invoice.id}:finalize` },
      );
      await stripe.invoices.sendInvoice(
        stripeInvoice.id,
        undefined,
        { idempotencyKey: `inv:${invoice.id}:send` },
      );

      stripeInvoice = await stripe.invoices.retrieve(stripeInvoice.id);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe API error';
    console.error('[send-invoice-via-stripe] Stripe error:', err);
    // Audit so admin can see where it failed; invoice stays in pending_send,
    // safe to retry (Stripe idempotency keys will dedup).
    await adminClient.from('invoice_events').insert({
      invoice_id: invoice.id,
      event_type: 'send_stripe_failed',
      actor_user_id: user.id,
      actor_role: 'owner',
      payload: {
        invoice_number: invoiceNumber,
        stripe_error: message,
      },
    });
    return new Response(JSON.stringify({ ok: false, error: `Stripe error: ${message}` }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Final UPDATE: pending_send → sent + Stripe IDs ────────────────────────
  const { error: updErr } = await adminClient
    .from('invoices')
    .update({
      status: 'sent',
      stripe_invoice_id: stripeInvoice.id,
      stripe_hosted_url: stripeInvoice.hosted_invoice_url ?? null,
      stripe_pdf_url: stripeInvoice.invoice_pdf ?? null,
      stripe_payment_intent_id:
        typeof stripeInvoice.payment_intent === 'string' ? stripeInvoice.payment_intent : null,
    })
    .eq('id', invoice.id)
    .in('status', ['pending_send', 'draft']); // tolerate either; CAS-ish

  if (updErr) {
    console.error(
      '[send-invoice-via-stripe] SPLIT-BRAIN: Stripe sent OK but DB UPDATE failed:',
      updErr,
    );
    // Loud audit row so an admin can reconcile. Stripe-side state is the
    // recoverable truth (stripe_invoice_id is in the payload).
    await adminClient.from('invoice_events').insert({
      invoice_id: invoice.id,
      event_type: 'send_db_update_failed',
      actor_user_id: user.id,
      actor_role: 'owner',
      payload: {
        invoice_number: invoiceNumber,
        stripe_invoice_id: stripeInvoice.id,
        stripe_hosted_url: stripeInvoice.hosted_invoice_url,
        stripe_pdf_url: stripeInvoice.invoice_pdf,
        db_error: updErr.message,
        recovery: 'retry POST send-invoice-via-stripe; idempotency keys will reuse this Stripe invoice',
      },
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'Stripe invoice sent but local DB update failed — retry the request to reconcile, ' +
          'or contact support. The recipient has already received the invoice.',
        stripe_invoice_id: stripeInvoice.id,
        invoice_number: invoiceNumber,
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Audit event
  await adminClient.from('invoice_events').insert({
    invoice_id: invoice.id,
    event_type: 'sent',
    actor_user_id: user.id,
    actor_role: 'owner',
    payload: {
      stripe_invoice_id: stripeInvoice.id,
      invoice_number: invoiceNumber,
      hosted_url: stripeInvoice.hosted_invoice_url,
      pdf_url: stripeInvoice.invoice_pdf,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      stripe_invoice_id: stripeInvoice.id,
      hosted_url: stripeInvoice.hosted_invoice_url,
      pdf_url: stripeInvoice.invoice_pdf,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
});

// ── Snapshot helpers ────────────────────────────────────────────────────────

function buildIssuerSnapshot(profile: BillingProfileRow): Record<string, unknown> {
  return {
    profile_id: profile.id,
    label: profile.label,
    billing_name: profile.billing_name,
    billing_address_1: profile.billing_address_1,
    billing_address_2: profile.billing_address_2,
    billing_city: profile.billing_city,
    billing_postal_code: profile.billing_postal_code,
    billing_state: profile.billing_state,
    billing_country: profile.billing_country,
    billing_email: profile.billing_email,
    vat_id: profile.vat_id,
    tax_id: profile.tax_id,
    iban: profile.iban,
    bic: profile.bic,
    bank_name: profile.bank_name,
    snapshot_at: new Date().toISOString(),
  };
}

function buildRecipientSnapshot(
  profile: BillingProfileRow | null,
  fallbackName: string,
  fallbackEmail: string,
): Record<string, unknown> {
  if (!profile) {
    return {
      billing_name: fallbackName,
      billing_email: fallbackEmail,
      snapshot_at: new Date().toISOString(),
    };
  }
  return {
    profile_id: profile.id,
    label: profile.label,
    billing_name: profile.billing_name,
    billing_address_1: profile.billing_address_1,
    billing_address_2: profile.billing_address_2,
    billing_city: profile.billing_city,
    billing_postal_code: profile.billing_postal_code,
    billing_state: profile.billing_state,
    billing_country: profile.billing_country,
    billing_email: profile.billing_email,
    vat_id: profile.vat_id,
    tax_id: profile.tax_id,
    snapshot_at: new Date().toISOString(),
  };
}
