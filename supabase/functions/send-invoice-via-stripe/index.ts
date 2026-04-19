/**
 * Edge Function: send-invoice-via-stripe
 *
 * Sends a DRAFT invoice via Stripe Invoicing.
 *
 * Flow:
 *   1. Verify caller JWT
 *   2. Verify caller is the owner of the issuer org (organizations.owner_id = auth.uid())
 *   3. Verify invoice is DRAFT and not already sent
 *   4. Reserve invoice_number via next_invoice_number RPC (gap-free, locked)
 *   5. Resolve / create Stripe customer for recipient org
 *   6. Freeze billing_profile_snapshot + recipient_billing_snapshot
 *   7. Create Stripe Invoice + InvoiceItem(s)
 *   8. Finalize + send via Stripe
 *   9. Update invoice row → status='sent', stripe_invoice_id, stripe_hosted_url, stripe_pdf_url, sent_at, sent_by
 *  10. Append invoice_events row
 *
 * Invariants:
 *   - I-PAY-1: payment authority is Stripe; we only mirror state from webhooks.
 *   - I-PAY-3: owner-only; enforced server-side, not just RLS.
 *   - I-PAY-9: no custodial funds — Stripe collects directly from payer.
 *   - PSP-agnostic table; this function hard-codes 'stripe' but the schema
 *     supports adyen|manual for future expansion.
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

  // ── Load invoice + line items + verify ownership ──────────────────────────
  const { data: invoice, error: invErr } = await adminClient
    .from('invoices')
    .select(
      'id, organization_id, recipient_organization_id, invoice_type, status, currency, ' +
        'subtotal_amount_cents, tax_amount_cents, total_amount_cents, tax_rate_percent, ' +
        'tax_mode, reverse_charge_applied, due_date, notes, source_option_request_id',
    )
    .eq('id', body.invoice_id)
    .maybeSingle();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ ok: false, error: 'Invoice not found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (invoice.status !== 'draft') {
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

  // Recipient profile may be incomplete; we fall back to org name + warn but
  // still proceed (Stripe customer can be created with minimal data).
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

  // ── Reserve invoice_number ────────────────────────────────────────────────
  // We use the service-role client; the function is SECDEF and tolerates a
  // null auth.uid() (trigger context), but here we have a user — pass the
  // header-bound client instead so the membership check passes through.
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

  const invoiceNumber = String(numberRes);

  // ── Stripe customer (idempotent: reuse if recipient already has one) ──────
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Resolve cached Stripe customer for the recipient.
  // Priority: organization_stripe_customers cache → organization_subscriptions
  // (recipient may already be a paying org with a Stripe customer attached).
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
    const customer = await stripe.customers.create({
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
    });
    recipientCustomerId = customer.id;

    // Cache for future invoices to the same recipient.
    await adminClient.from('organization_stripe_customers').upsert(
      {
        organization_id: invoice.recipient_organization_id,
        stripe_customer_id: recipientCustomerId,
        purpose: 'invoice_recipient',
      },
      { onConflict: 'organization_id', ignoreDuplicates: false },
    );
  }

  // ── Tax handling ──────────────────────────────────────────────────────────
  // Two mutually exclusive modes:
  //   1. STRIPE_TAX_ENABLED=true  → Stripe Tax computes tax automatically
  //      (requires Stripe Tax to be active on the account; ignores tax_rate_percent).
  //   2. STRIPE_TAX_ENABLED=false → Manual MVP path: if invoice.tax_rate_percent > 0
  //      and reverse_charge_applied is false, we create a Stripe TaxRate on-the-fly
  //      and attach it to each invoice item via tax_rates. If reverse charge applies
  //      or rate is 0, no tax is added (the recipient sees a 0 tax line).
  const manualTaxRatePercent = !stripeTaxEnabled
    && !invoice.reverse_charge_applied
    && Number(invoice.tax_rate_percent ?? 0) > 0
    ? Number(invoice.tax_rate_percent)
    : 0;

  let manualTaxRateId: string | null = null;
  if (manualTaxRatePercent > 0) {
    try {
      const taxRate = await stripe.taxRates.create({
        display_name: `VAT ${manualTaxRatePercent}%`,
        percentage: manualTaxRatePercent,
        inclusive: false,
        country: issuerProfile.billing_country ?? undefined,
        metadata: {
          invoice_id: invoice.id,
          organization_id: invoice.organization_id,
          source: 'send-invoice-via-stripe',
        },
      });
      manualTaxRateId = taxRate.id;
    } catch (err) {
      console.warn('[send-invoice-via-stripe] tax rate creation failed; sending without tax:', err);
    }
  }

  // ── Create Stripe invoice ────────────────────────────────────────────────
  let stripeInvoice: Stripe.Invoice;
  try {
    stripeInvoice = await stripe.invoices.create({
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
    });

    for (const item of lineItems) {
      await stripe.invoiceItems.create({
        customer: recipientCustomerId,
        invoice: stripeInvoice.id,
        currency: (item.currency ?? invoice.currency ?? 'EUR').toLowerCase(),
        description: item.description,
        quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1))),
        unit_amount: Number(item.unit_amount_cents ?? 0),
      });
    }

    stripeInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id, {
      auto_advance: false,
    });
    await stripe.invoices.sendInvoice(stripeInvoice.id);

    stripeInvoice = await stripe.invoices.retrieve(stripeInvoice.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe API error';
    console.error('[send-invoice-via-stripe] Stripe error:', err);
    return new Response(JSON.stringify({ ok: false, error: `Stripe error: ${message}` }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Persist updates: status='sent', snapshots, Stripe IDs ────────────────
  const billingSnapshot = {
    profile_id: issuerProfile.id,
    label: issuerProfile.label,
    billing_name: issuerProfile.billing_name,
    billing_address_1: issuerProfile.billing_address_1,
    billing_address_2: issuerProfile.billing_address_2,
    billing_city: issuerProfile.billing_city,
    billing_postal_code: issuerProfile.billing_postal_code,
    billing_state: issuerProfile.billing_state,
    billing_country: issuerProfile.billing_country,
    billing_email: issuerProfile.billing_email,
    vat_id: issuerProfile.vat_id,
    tax_id: issuerProfile.tax_id,
    iban: issuerProfile.iban,
    bic: issuerProfile.bic,
    bank_name: issuerProfile.bank_name,
    snapshot_at: new Date().toISOString(),
  };

  const recipientSnapshot = recipientProfile
    ? {
        profile_id: recipientProfile.id,
        label: recipientProfile.label,
        billing_name: recipientProfile.billing_name,
        billing_address_1: recipientProfile.billing_address_1,
        billing_address_2: recipientProfile.billing_address_2,
        billing_city: recipientProfile.billing_city,
        billing_postal_code: recipientProfile.billing_postal_code,
        billing_state: recipientProfile.billing_state,
        billing_country: recipientProfile.billing_country,
        billing_email: recipientProfile.billing_email,
        vat_id: recipientProfile.vat_id,
        tax_id: recipientProfile.tax_id,
        snapshot_at: new Date().toISOString(),
      }
    : { billing_name: recipientName, billing_email: recipientEmail, snapshot_at: new Date().toISOString() };

  const { error: updErr } = await adminClient
    .from('invoices')
    .update({
      status: 'sent',
      invoice_number: invoiceNumber,
      stripe_invoice_id: stripeInvoice.id,
      stripe_hosted_url: stripeInvoice.hosted_invoice_url ?? null,
      stripe_pdf_url: stripeInvoice.invoice_pdf ?? null,
      stripe_payment_intent_id:
        typeof stripeInvoice.payment_intent === 'string' ? stripeInvoice.payment_intent : null,
      billing_profile_snapshot: billingSnapshot,
      recipient_billing_snapshot: recipientSnapshot,
      sent_at: new Date().toISOString(),
      sent_by: user.id,
    })
    .eq('id', invoice.id);

  if (updErr) {
    console.error('[send-invoice-via-stripe] Failed to persist invoice update:', updErr);
    // The Stripe invoice was already sent — log loudly, return error so caller knows.
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Stripe invoice sent but local DB update failed — please contact support',
        stripe_invoice_id: stripeInvoice.id,
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
