/**
 * Edge Function: send-invoice-via-email
 *
 * Sends a DRAFT invoice as an HTML e-mail (via Resend) — alternative
 * delivery path to send-invoice-via-stripe. Used when the agency wants to
 * deliver the invoice directly to the recipient's billing inbox without
 * onboarding the recipient as a Stripe Customer (typical for
 * agency_to_agency settlements or agency_to_client where the client pays
 * via SEPA/bank transfer).
 *
 * State machine (mirrors send-invoice-via-stripe Phase B.4 pre-lock):
 *   draft         (initial)
 *     │  pre-lock UPDATE: status='draft' → 'pending_send' (CAS)
 *     │  + sent_by + sent_at
 *     ▼
 *   pending_send  (number not yet drawn, snapshots not yet bound)
 *     │  draw next_invoice_number
 *     │  bind invoice_number + billing_profile_snapshot + recipient_billing_snapshot
 *     │  Resend dispatch
 *     │  final UPDATE: pending_send → sent
 *     │  + delivery_method='email' + email_recipient + email_subject
 *     │  + email_sent_at + email_message_id
 *     ▼
 *   sent          (terminal for this function)
 *
 * Re-entry rules:
 *   - status='draft'        → full pipeline.
 *   - status='pending_send' AND email_message_id IS NULL
 *                           → resend (idempotency at Resend is best-effort,
 *                             but every retry will re-dispatch — that is
 *                             acceptable for e-mail because the recipient
 *                             may legitimately need the resend).
 *                           → invoice_number is reused (already set).
 *   - status='pending_send' AND email_message_id IS NOT NULL
 *                           → split-brain recovery: skip Resend, just final
 *                             UPDATE to mark 'sent'.
 *   - status='sent' / 'paid' / etc.
 *                           → 409 conflict (use a separate "resend e-mail"
 *                             endpoint in future if needed; outside scope).
 *
 * Invariants (parity with send-invoice-via-stripe):
 *   - F2.3 / F2.5: snapshots + invoice_number freeze on pending_send → sent;
 *                  same DB triggers, no special-casing needed here.
 *   - I-PAY-3 / Phase A: member-write (owner OR booker/employee), enforced
 *                  server-side AND by RLS.
 *   - delivery_method is set to 'email' on the final UPDATE and never
 *     mutated afterwards (audit/accounting integrity).
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *   RESEND_API_KEY
 *
 * Deploy:
 *   supabase functions deploy send-invoice-via-email
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

const ALWAYS_ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
];

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = 'Index Casting Billing <billing@index-casting.com>';

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALWAYS_ALLOWED_ORIGINS.includes(origin) ? origin : ALWAYS_ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

interface SendInvoiceViaEmailRequest {
  invoice_id: string;
  /** Optional override; defaults to recipient billing profile email. */
  to?: string;
  /** Optional CC list (operator may want to BCC themselves). */
  cc?: string[];
  /** Optional subject override. */
  subject?: string;
  /** Optional free-form message prepended to the HTML body. */
  message?: string;
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

interface InvoiceLineItem {
  id: string;
  description: string | null;
  quantity: number | null;
  unit_amount_cents: number | null;
  total_amount_cents: number | null;
  currency: string | null;
  position: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s: string | null | undefined): s is string {
  return !!s && EMAIL_RE.test(s);
}

function escHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtCents(cents: number | null | undefined, currency: string): string {
  const n = Number(cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'EUR').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || 'EUR'}`;
  }
}

function buildInvoiceHtml(args: {
  issuer: BillingProfileRow;
  recipientName: string;
  recipientSnapshot: BillingProfileRow | null;
  invoice: {
    invoice_number: string;
    currency: string;
    notes: string | null;
    due_date: string | null;
    subtotal_amount_cents: number | null;
    tax_amount_cents: number | null;
    total_amount_cents: number | null;
    tax_rate_percent: number | null;
    reverse_charge_applied: boolean | null;
  };
  lineItems: InvoiceLineItem[];
  customMessage: string | null;
}): string {
  const { issuer, recipientName, recipientSnapshot, invoice, lineItems, customMessage } = args;
  const cur = invoice.currency || 'EUR';

  const itemsHtml = lineItems
    .map(
      (it) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top;">
            ${escHtml(it.description ?? '—')}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">
            ${escHtml(String(it.quantity ?? 1))}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">
            ${escHtml(fmtCents(it.unit_amount_cents, cur))}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">
            ${escHtml(fmtCents(it.total_amount_cents, cur))}
          </td>
        </tr>`,
    )
    .join('');

  const issuerAddr = [
    issuer.billing_address_1,
    issuer.billing_address_2,
    [issuer.billing_postal_code, issuer.billing_city].filter(Boolean).join(' '),
    issuer.billing_country,
  ]
    .filter(Boolean)
    .map(escHtml)
    .join('<br>');

  const recAddr = recipientSnapshot
    ? [
        recipientSnapshot.billing_address_1,
        recipientSnapshot.billing_address_2,
        [recipientSnapshot.billing_postal_code, recipientSnapshot.billing_city].filter(Boolean).join(' '),
        recipientSnapshot.billing_country,
      ]
        .filter(Boolean)
        .map(escHtml)
        .join('<br>')
    : '';

  const reverseChargeBlock = invoice.reverse_charge_applied
    ? `<p style="font-size:13px;color:#444;margin:16px 0 0;">
         <em>Reverse charge — VAT to be accounted for by the recipient.</em>
       </p>`
    : '';

  const taxLine =
    !invoice.reverse_charge_applied && Number(invoice.tax_rate_percent ?? 0) > 0
      ? `<tr>
           <td colspan="3" style="padding:6px 12px;text-align:right;color:#666;">
             Tax (${escHtml(String(invoice.tax_rate_percent))}%)
           </td>
           <td style="padding:6px 12px;text-align:right;">
             ${escHtml(fmtCents(invoice.tax_amount_cents, cur))}
           </td>
         </tr>`
      : '';

  const customBlock = customMessage
    ? `<div style="margin:0 0 24px;padding:12px 16px;background:#fafafa;border-left:3px solid #ddd;
                  font-size:14px;color:#333;line-height:1.5;white-space:pre-wrap;">
         ${escHtml(customMessage)}
       </div>`
    : '';

  const bankBlock =
    issuer.iban || issuer.bic || issuer.bank_name
      ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:13px;color:#444;">
           <strong>Bank details</strong><br>
           ${issuer.bank_name ? escHtml(issuer.bank_name) + '<br>' : ''}
           ${issuer.iban ? 'IBAN: ' + escHtml(issuer.iban) + '<br>' : ''}
           ${issuer.bic ? 'BIC: ' + escHtml(issuer.bic) : ''}
         </div>`
      : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
             color:#222;background:#f4f4f4;padding:24px;margin:0;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px;">
    <h1 style="font-size:22px;margin:0 0 4px;color:#111;">Invoice ${escHtml(invoice.invoice_number)}</h1>
    <p style="margin:0 0 24px;color:#666;font-size:14px;">
      ${invoice.due_date ? `Due ${escHtml(invoice.due_date)}` : 'No due date specified'}
    </p>
    ${customBlock}
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">From</div>
          <div style="font-size:14px;line-height:1.5;">
            <strong>${escHtml(issuer.billing_name ?? '')}</strong><br>
            ${issuerAddr}
            ${issuer.vat_id ? '<br>VAT: ' + escHtml(issuer.vat_id) : ''}
            ${issuer.tax_id ? '<br>Tax: ' + escHtml(issuer.tax_id) : ''}
          </div>
        </td>
        <td style="vertical-align:top;width:50%;padding-left:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Bill to</div>
          <div style="font-size:14px;line-height:1.5;">
            <strong>${escHtml(recipientName)}</strong><br>
            ${recAddr}
            ${recipientSnapshot?.vat_id ? '<br>VAT: ' + escHtml(recipientSnapshot.vat_id) : ''}
          </div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <thead>
        <tr style="background:#fafafa;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #eee;">Description</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;border-bottom:2px solid #eee;">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;border-bottom:2px solid #eee;">Unit</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;border-bottom:2px solid #eee;">Total</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:6px 12px;text-align:right;color:#666;">Subtotal</td>
          <td style="padding:6px 12px;text-align:right;">${escHtml(fmtCents(invoice.subtotal_amount_cents, cur))}</td>
        </tr>
        ${taxLine}
        <tr>
          <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:600;border-top:2px solid #222;">Total</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;border-top:2px solid #222;">
            ${escHtml(fmtCents(invoice.total_amount_cents, cur))}
          </td>
        </tr>
      </tfoot>
    </table>
    ${reverseChargeBlock}
    ${
      invoice.notes
        ? `<div style="margin-top:24px;font-size:13px;color:#444;white-space:pre-wrap;">${escHtml(invoice.notes)}</div>`
        : ''
    }
    ${bankBlock}
    <p style="margin-top:32px;font-size:12px;color:#999;text-align:center;">
      Sent via Index Casting · billing@index-casting.com
    </p>
  </div>
</body></html>`;
}

Deno.serve(withObservability('send-invoice-via-email', async (req: Request) => {
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
  const resendKey = Deno.env.get('RESEND_API_KEY');

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!resendKey) {
    return new Response(JSON.stringify({ ok: false, error: 'email_service_not_configured' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

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

  let body: SendInvoiceViaEmailRequest;
  try {
    body = (await req.json()) as SendInvoiceViaEmailRequest;
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Load invoice ───────────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await adminClient
    .from('invoices')
    .select(
      'id, organization_id, recipient_organization_id, invoice_type, status, currency, ' +
        'subtotal_amount_cents, tax_amount_cents, total_amount_cents, tax_rate_percent, ' +
        'tax_mode, reverse_charge_applied, due_date, notes, ' +
        'invoice_number, billing_profile_snapshot, recipient_billing_snapshot, ' +
        'delivery_method, email_recipient, email_subject, email_message_id',
    )
    .eq('id', body.invoice_id)
    .maybeSingle();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ ok: false, error: 'Invoice not found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (invoice.status !== 'draft' && invoice.status !== 'pending_send') {
    return new Response(
      JSON.stringify({ ok: false, error: `Invoice cannot be sent: status='${invoice.status}'` }),
      { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Defensive: if a previous attempt locked this invoice for stripe delivery,
  // do not switch it to email mid-flight.
  if (invoice.delivery_method && invoice.delivery_method !== 'email') {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Invoice is already locked for delivery via ${invoice.delivery_method}; cannot switch to email.`,
      }),
      { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Membership check (Phase A) ────────────────────────────────────────────
  const { data: issuerOrg } = await adminClient
    .from('organizations')
    .select('id, name, owner_id')
    .eq('id', invoice.organization_id)
    .maybeSingle();

  if (!issuerOrg) {
    return new Response(JSON.stringify({ ok: false, error: 'Issuer organization not found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const isOwner = issuerOrg.owner_id === user.id;
  let isMember = isOwner;
  if (!isMember) {
    const { data: memberRow } = await adminClient
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', invoice.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();
    isMember = !!memberRow;
  }
  if (!isMember) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Only members of the issuer organization can send invoices' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
  const actorRole: string = isOwner ? 'owner' : 'member';

  if (!invoice.recipient_organization_id) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invoice has no recipient organization' }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Line items ─────────────────────────────────────────────────────────────
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

  // ── Issuer + recipient billing profiles ───────────────────────────────────
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

  const recipientName = recipientProfile?.billing_name ?? recipientOrg?.name ?? 'Customer';

  // ── Resolve recipient e-mail ───────────────────────────────────────────────
  // Priority: explicit body.to (operator override) → recipient billing profile email.
  const requestedTo = (body.to ?? '').trim();
  const fallbackTo = (recipientProfile?.billing_email ?? '').trim();
  const finalTo = requestedTo.length > 0 ? requestedTo : fallbackTo;

  if (!isValidEmail(finalTo)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'Recipient e-mail is missing or invalid. Provide an explicit e-mail or set one ' +
          "in the recipient organization's billing profile.",
      }),
      { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Normalize CC list (strict validation; silently drop invalid entries to
  // avoid breaking the send for an operator typo, but log it).
  const ccList = Array.isArray(body.cc)
    ? body.cc.map((s) => (s ?? '').trim()).filter((s) => isValidEmail(s))
    : [];

  // ── Pre-lock + invoice number + snapshots (parity w/ Stripe path) ─────────
  let invoiceNumber: string;
  if (invoice.status === 'draft') {
    const { error: lockErr, data: lockedRow } = await adminClient
      .from('invoices')
      .update({
        status: 'pending_send',
        sent_at: new Date().toISOString(),
        sent_by: user.id,
      })
      .eq('id', invoice.id)
      .eq('status', 'draft')
      .is('invoice_number', null)
      .select('id')
      .maybeSingle();

    if (lockErr || !lockedRow) {
      console.error('[send-invoice-via-email] pre-lock failed:', lockErr);
      await adminClient.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: 'send_email_prelock_failed',
        actor_user_id: user.id,
        actor_role: actorRole,
        payload: {
          db_error: lockErr?.message ?? 'no row updated (status changed concurrently or not draft)',
        },
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to lock invoice for sending — it may already be in progress. Please retry.',
        }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: numberRes, error: numberErr } = await userClient.rpc('next_invoice_number', {
      p_organization_id: invoice.organization_id,
      p_invoice_type: invoice.invoice_type,
      p_year: null,
    });
    if (numberErr || !numberRes) {
      console.error('[send-invoice-via-email] next_invoice_number failed:', numberErr);
      await adminClient.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: 'send_email_number_failed',
        actor_user_id: user.id,
        actor_role: actorRole,
        payload: {
          db_error: numberErr?.message ?? 'next_invoice_number returned NULL',
          recovery: 'invoice locked in pending_send without number; admin can roll back to draft or re-call.',
        },
      });
      return new Response(JSON.stringify({ ok: false, error: 'Failed to reserve invoice number' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    invoiceNumber = String(numberRes);

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
      : {
          billing_name: recipientName,
          billing_email: finalTo,
          snapshot_at: new Date().toISOString(),
        };

    const { error: bindErr } = await adminClient
      .from('invoices')
      .update({
        invoice_number: invoiceNumber,
        billing_profile_snapshot: billingSnapshot,
        recipient_billing_snapshot: recipientSnapshot,
      })
      .eq('id', invoice.id)
      .eq('status', 'pending_send')
      .is('invoice_number', null);

    if (bindErr) {
      console.error('[send-invoice-via-email] bind failed:', bindErr);
      await adminClient.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: 'send_email_bind_failed',
        actor_user_id: user.id,
        actor_role: actorRole,
        payload: {
          reserved_invoice_number: invoiceNumber,
          db_error: bindErr.message,
          recovery: 'retry — invoice locked in pending_send; bind step is idempotent via .is(null) guard',
        },
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to bind invoice number — please retry.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    // Re-entry from pending_send.
    if (!invoice.invoice_number) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invoice is in pending_send without a number — admin recovery needed.',
        }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    invoiceNumber = invoice.invoice_number;

    if (invoice.email_message_id) {
      // Split-brain recovery: e-mail was already sent, only the final UPDATE failed.
      const { error: finalErr } = await adminClient
        .from('invoices')
        .update({ status: 'sent', delivery_method: 'email' })
        .eq('id', invoice.id)
        .eq('status', 'pending_send');
      if (finalErr) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'E-mail already dispatched but DB finalisation still failing — contact support.',
            email_message_id: invoice.email_message_id,
          }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          invoice_id: invoice.id,
          invoice_number: invoiceNumber,
          email_message_id: invoice.email_message_id,
          recovered: true,
        }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  }

  // ── Build + dispatch HTML e-mail ───────────────────────────────────────────
  const subject =
    body.subject?.trim() && body.subject.trim().length > 0
      ? body.subject.trim()
      : `Invoice ${invoiceNumber} from ${issuerProfile.billing_name ?? issuerOrg.name}`;

  const html = buildInvoiceHtml({
    issuer: issuerProfile,
    recipientName,
    recipientSnapshot: recipientProfile,
    invoice: {
      invoice_number: invoiceNumber,
      currency: invoice.currency ?? 'EUR',
      notes: invoice.notes,
      due_date: invoice.due_date,
      subtotal_amount_cents: invoice.subtotal_amount_cents,
      tax_amount_cents: invoice.tax_amount_cents,
      total_amount_cents: invoice.total_amount_cents,
      tax_rate_percent: invoice.tax_rate_percent,
      reverse_charge_applied: invoice.reverse_charge_applied,
    },
    lineItems,
    customMessage: body.message?.trim() || null,
  });

  let resendMessageId: string | null = null;
  try {
    const resendRes = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [finalTo],
        cc: ccList.length > 0 ? ccList : undefined,
        subject,
        html,
        reply_to: issuerProfile.billing_email ?? undefined,
      }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      console.error('[send-invoice-via-email] Resend error:', resendRes.status, errorText);

      // Record failure on the invoice for Smart Attention.
      await adminClient
        .from('invoices')
        .update({
          last_email_failure_at: new Date().toISOString(),
          last_email_failure_reason: `Resend ${resendRes.status}: ${errorText.slice(0, 500)}`,
        })
        .eq('id', invoice.id);

      await adminClient.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: 'send_email_failed',
        actor_user_id: user.id,
        actor_role: actorRole,
        payload: {
          invoice_number: invoiceNumber,
          to: finalTo,
          resend_status: resendRes.status,
          resend_error: errorText.slice(0, 1000),
        },
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'E-mail dispatch failed. Invoice remains in pending_send — fix the recipient or retry.',
          detail: errorText,
        }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const resendData = (await resendRes.json()) as { id?: string };
    resendMessageId = resendData.id ?? null;
  } catch (e) {
    console.error('[send-invoice-via-email] fetch exception:', e);
    const reason = e instanceof Error ? e.message : 'unknown fetch exception';
    await adminClient
      .from('invoices')
      .update({
        last_email_failure_at: new Date().toISOString(),
        last_email_failure_reason: `Network: ${reason}`,
      })
      .eq('id', invoice.id);
    return new Response(
      JSON.stringify({ ok: false, error: 'E-mail dispatch network exception — please retry.' }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Final UPDATE: pending_send → sent + email metadata ────────────────────
  const { error: finalErr } = await adminClient
    .from('invoices')
    .update({
      status: 'sent',
      delivery_method: 'email',
      email_recipient: finalTo,
      email_subject: subject,
      email_sent_at: new Date().toISOString(),
      email_message_id: resendMessageId,
      // Clear stale failure markers from previous attempts.
      last_email_failure_at: null,
      last_email_failure_reason: null,
    })
    .eq('id', invoice.id)
    .eq('status', 'pending_send');

  if (finalErr) {
    console.error(
      '[send-invoice-via-email] SPLIT-BRAIN: e-mail sent OK but DB UPDATE failed:',
      finalErr,
    );
    await adminClient.from('invoice_events').insert({
      invoice_id: invoice.id,
      event_type: 'send_email_db_update_failed',
      actor_user_id: user.id,
      actor_role: actorRole,
      payload: {
        invoice_number: invoiceNumber,
        to: finalTo,
        email_message_id: resendMessageId,
        db_error: finalErr.message,
        recovery: 'retry POST send-invoice-via-email; recovery branch will finalise without re-sending',
      },
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'E-mail dispatched but local DB update failed. Retry the request to reconcile, ' +
          'or contact support. Recipient has already received the invoice.',
        email_message_id: resendMessageId,
        invoice_number: invoiceNumber,
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  await adminClient.from('invoice_events').insert({
    invoice_id: invoice.id,
    event_type: 'sent_via_email',
    actor_user_id: user.id,
    actor_role: actorRole,
    payload: {
      invoice_number: invoiceNumber,
      delivery_method: 'email',
      to: finalTo,
      cc: ccList,
      subject,
      email_message_id: resendMessageId,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
      delivery_method: 'email',
      to: finalTo,
      email_message_id: resendMessageId,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}));
