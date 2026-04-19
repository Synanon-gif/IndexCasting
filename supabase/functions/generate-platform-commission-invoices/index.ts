/**
 * Edge Function: generate-platform-commission-invoices
 *
 * Generates platform_to_agency commission invoice DRAFTS for a given period.
 * Designed to run as a monthly cron (Supabase Cron / external scheduler).
 *
 * Period selection (priority):
 *   1. Body { period_start: 'YYYY-MM-DD', period_end: 'YYYY-MM-DD' }
 *   2. Default: previous full calendar month (UTC)
 *
 * Commission rate:
 *   ENV PLATFORM_COMMISSION_RATE_PERCENT (e.g. '5' → 5%). Default: 5.
 *   Override per agency via organization_billing_defaults.metadata.commission_rate_percent
 *   (future enhancement; MVP uses platform-wide rate).
 *
 * Issuer org:
 *   ENV PLATFORM_ORGANIZATION_ID — the org that issues commission invoices.
 *
 * Multi-currency:
 *   One invoice per (agency_org, currency). The unique index
 *   uq_invoices_platform_commission_period guarantees idempotency.
 *
 * Authentication:
 *   Header `x-cron-secret: <CRON_SECRET>` required, OR caller must be admin
 *   (verified via JWT). No anonymous access.
 *
 * Returns: { ok, period_start, period_end, invoices_created, invoices_skipped }
 *
 * Deploy:
 *   supabase functions deploy generate-platform-commission-invoices
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *   CRON_SECRET                              (random; rotate periodically)
 *   PLATFORM_ORGANIZATION_ID                 (uuid of the platform org)
 *   PLATFORM_COMMISSION_RATE_PERCENT         (numeric, default 5)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    Vary: 'Origin',
  };
}

interface Body {
  period_start?: string; // YYYY-MM-DD inclusive
  period_end?: string;   // YYYY-MM-DD inclusive
}

interface AggregatedRow {
  agency_organization_id: string;
  currency: string;
  total_amount: number; // major units (e.g. EUR), NOT cents
  job_count: number;
  option_request_ids: string[];
}

function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  const startThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endLastMonth = new Date(startThisMonth.getTime() - 24 * 60 * 60 * 1000);
  const startLastMonth = new Date(Date.UTC(endLastMonth.getUTCFullYear(), endLastMonth.getUTCMonth(), 1));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { start: fmt(startLastMonth), end: fmt(endLastMonth) };
}

Deno.serve(withObservability('generate-platform-commission-invoices', async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl   = Deno.env.get('SUPABASE_URL');
  const serviceRole   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey       = Deno.env.get('SUPABASE_ANON_KEY');
  const cronSecret    = Deno.env.get('CRON_SECRET');
  const platformOrgId = Deno.env.get('PLATFORM_ORGANIZATION_ID');
  const ratePercent   = Number(Deno.env.get('PLATFORM_COMMISSION_RATE_PERCENT') ?? '5');

  if (!supabaseUrl || !serviceRole || !anonKey || !cronSecret || !platformOrgId) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    return new Response(
      JSON.stringify({ ok: false, error: 'PLATFORM_COMMISSION_RATE_PERCENT invalid' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Auth: cron secret OR admin JWT ───────────────────────────────────────
  const headerSecret = req.headers.get('x-cron-secret');
  let isAuthed = false;
  let actorUserId: string | null = null;

  if (headerSecret && headerSecret === cronSecret) {
    isAuthed = true;
  } else {
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const adminCheckClient = createClient(supabaseUrl, serviceRole, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: prof } = await adminCheckClient
          .from('profiles')
          .select('is_admin, role')
          .eq('id', user.id)
          .maybeSingle();
        if (prof?.is_admin === true || prof?.role === 'admin') {
          isAuthed = true;
          actorUserId = user.id;
        }
      }
    }
  }

  if (!isAuthed) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse body / determine period ────────────────────────────────────────
  let body: Body = {};
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as Body) : {};
  } catch {
    body = {};
  }

  const { start: defaultStart, end: defaultEnd } = previousMonthRange();
  const periodStart = body.period_start ?? defaultStart;
  const periodEnd   = body.period_end ?? defaultEnd;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'period_start/period_end must be YYYY-MM-DD' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify platform org exists
  const { data: platformOrg } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', platformOrgId)
    .maybeSingle();
  if (!platformOrg) {
    return new Response(
      JSON.stringify({ ok: false, error: 'PLATFORM_ORGANIZATION_ID does not exist' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // ── Aggregate confirmed jobs by (agency_org, currency) ───────────────────
  // We pull all confirmed rows in the period, then aggregate in JS.
  // Volume per month is small enough (thousands at most) to do this in memory.
  const { data: jobs, error: jobsErr } = await admin
    .from('option_requests')
    .select(
      'id, agency_organization_id, currency, agency_counter_price, proposed_price, requested_date, final_status',
    )
    .eq('final_status', 'job_confirmed')
    .gte('requested_date', periodStart)
    .lte('requested_date', periodEnd)
    .not('agency_organization_id', 'is', null);

  if (jobsErr) {
    console.error('[generate-platform-commission-invoices] fetch jobs error:', jobsErr);
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to fetch jobs' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const grouped = new Map<string, AggregatedRow>();
  for (const j of jobs ?? []) {
    const agencyOrg = j.agency_organization_id as string | null;
    if (!agencyOrg) continue;
    const currency = (j.currency as string | null) ?? 'EUR';
    const price = Number(j.agency_counter_price ?? j.proposed_price ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = `${agencyOrg}__${currency.toUpperCase()}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.total_amount += price;
      existing.job_count += 1;
      existing.option_request_ids.push(j.id as string);
    } else {
      grouped.set(key, {
        agency_organization_id: agencyOrg,
        currency: currency.toUpperCase(),
        total_amount: price,
        job_count: 1,
        option_request_ids: [j.id as string],
      });
    }
  }

  let invoicesCreated = 0;
  let invoicesSkipped = 0;
  const errors: Array<{ agency_org: string; currency: string; error: string }> = [];

  for (const row of grouped.values()) {
    try {
      // Idempotency: relies on uq_invoices_platform_commission_period
      // (organization_id, recipient_organization_id, invoice_type, period_start, period_end, currency).
      // First check, then insert; if a race collides, the unique violation
      // (23505) is caught and counted as skipped.
      const { data: existing } = await admin
        .from('invoices')
        .select('id')
        .eq('organization_id', platformOrgId)
        .eq('recipient_organization_id', row.agency_organization_id)
        .eq('invoice_type', 'platform_to_agency')
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .eq('currency', row.currency)
        .maybeSingle();

      if (existing) {
        invoicesSkipped += 1;
        continue;
      }

      const grossCents = Math.round(row.total_amount * 100);
      const commissionCents = Math.round((grossCents * ratePercent) / 100);

      const { data: invoice, error: insErr } = await admin
        .from('invoices')
        .insert({
          organization_id: platformOrgId,
          recipient_organization_id: row.agency_organization_id,
          invoice_type: 'platform_to_agency',
          status: 'draft',
          currency: row.currency,
          subtotal_amount_cents: commissionCents,
          tax_amount_cents: 0,
          total_amount_cents: commissionCents,
          period_start: periodStart,
          period_end: periodEnd,
          created_by: actorUserId,
          notes:
            `Platform commission ${ratePercent}% on ${row.job_count} confirmed job(s) ` +
            `from ${periodStart} to ${periodEnd}.`,
        })
        .select('id')
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          invoicesSkipped += 1;
          continue;
        }
        throw insErr;
      }

      // Single line item summarising the period
      const { error: lineErr } = await admin.from('invoice_line_items').insert({
        invoice_id: invoice!.id,
        description:
          `Platform commission (${ratePercent}%) — ${row.job_count} confirmed job(s) ` +
          `· gross ${(row.total_amount).toFixed(2)} ${row.currency} · ${periodStart}…${periodEnd}`,
        quantity: 1,
        unit_amount_cents: commissionCents,
        total_amount_cents: commissionCents,
        currency: row.currency,
        position: 0,
        metadata: {
          option_request_ids: row.option_request_ids,
          job_count: row.job_count,
          gross_amount: row.total_amount,
          rate_percent: ratePercent,
        },
      });

      if (lineErr) throw lineErr;

      await admin.from('invoice_events').insert({
        invoice_id: invoice!.id,
        event_type: 'auto_draft_created',
        actor_user_id: actorUserId,
        actor_role: 'cron',
        payload: {
          source: 'generate-platform-commission-invoices',
          period_start: periodStart,
          period_end: periodEnd,
          rate_percent: ratePercent,
          job_count: row.job_count,
          gross_amount: row.total_amount,
          currency: row.currency,
        },
      });

      invoicesCreated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        '[generate-platform-commission-invoices] failed for',
        row.agency_organization_id, row.currency, msg,
      );
      errors.push({ agency_org: row.agency_organization_id, currency: row.currency, error: msg });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      period_start: periodStart,
      period_end: periodEnd,
      rate_percent: ratePercent,
      groups_total: grouped.size,
      invoices_created: invoicesCreated,
      invoices_skipped: invoicesSkipped,
      errors,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}));
