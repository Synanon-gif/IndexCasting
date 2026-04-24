/**
 * Manual Invoice services — header + line items + numbering.
 *
 * Strictly separate from the Stripe-routed `invoices` table services
 * (`invoicesSupabase.ts`). Every call is agency-org scoped.
 *
 * Lifecycle:
 *   draft → generated  (immutable snapshots frozen on generate)
 *   draft → void       (RPC-owned in future; Phase 1: only DELETE for drafts)
 *
 * Async contract: Option A (`boolean` / `null` / `[]` / `{ ok }`).
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import { computeManualInvoiceTotals, toLineLike } from '../utils/manualInvoiceTotals';
import {
  getManualAgencyBillingProfile,
  getManualBillingCounterparty,
} from './manualBillingProfilesSupabase';
import type {
  ManualInvoiceDirection,
  ManualInvoiceHeaderInput,
  ManualInvoiceLineItemInput,
  ManualInvoiceLineItemRow,
  ManualInvoiceRow,
  ManualInvoiceStatus,
  ManualInvoiceWithLines,
} from '../types/manualBillingTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Validate that the sender / recipient FK pair on the header matches the
 * direction. Returns null on success or a short reason string on failure.
 */
export function validateDirectionParticipants(
  payload: Pick<
    ManualInvoiceHeaderInput,
    | 'direction'
    | 'sender_agency_profile_id'
    | 'sender_counterparty_id'
    | 'recipient_agency_profile_id'
    | 'recipient_counterparty_id'
  >,
  opts: { requireBothSelected?: boolean } = {},
): string | null {
  const {
    direction,
    sender_agency_profile_id: sa,
    sender_counterparty_id: sc,
    recipient_agency_profile_id: ra,
    recipient_counterparty_id: rc,
  } = payload;

  // First: a side may have at most ONE selection (agency XOR counterparty).
  if (sa && sc) return 'sender_must_be_either_agency_or_counterparty';
  if (ra && rc) return 'recipient_must_be_either_agency_or_counterparty';

  switch (direction) {
    case 'agency_to_client':
      if (opts.requireBothSelected) {
        if (!sa) return 'missing_sender_agency_profile';
        if (!rc) return 'missing_recipient_client_profile';
      }
      // If a side is selected, it must use the right table.
      if (sc) return 'agency_to_client_sender_must_be_agency_profile';
      if (ra) return 'agency_to_client_recipient_must_be_counterparty';
      return null;

    case 'agency_to_model':
      if (opts.requireBothSelected) {
        if (!sa) return 'missing_sender_agency_profile';
        if (!rc) return 'missing_recipient_model_profile';
      }
      if (sc) return 'agency_to_model_sender_must_be_agency_profile';
      if (ra) return 'agency_to_model_recipient_must_be_counterparty';
      return null;

    case 'model_to_agency':
      if (opts.requireBothSelected) {
        if (!sc) return 'missing_sender_model_profile';
        if (!ra) return 'missing_recipient_agency_profile';
      }
      if (sa) return 'model_to_agency_sender_must_be_counterparty';
      if (rc) return 'model_to_agency_recipient_must_be_agency_profile';
      return null;

    default:
      return 'invalid_direction';
  }
}

// ── Numbering ──────────────────────────────────────────────────────────────

export async function suggestNextManualInvoiceNumber(
  agencyOrgId: string,
  prefix: string = 'INV',
): Promise<string | null> {
  if (!assertOrgContext(agencyOrgId, 'suggestNextManualInvoiceNumber')) return null;
  try {
    const { data, error } = await supabase.rpc('suggest_next_manual_invoice_number', {
      p_agency_organization_id: agencyOrgId,
      p_prefix: prefix,
    });
    if (error) {
      console.error('[suggestNextManualInvoiceNumber] error:', error);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (e) {
    console.error('[suggestNextManualInvoiceNumber] exception:', e);
    return null;
  }
}

export async function isManualInvoiceNumberTaken(
  agencyOrgId: string,
  invoiceNumber: string,
  excludeInvoiceId?: string | null,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'isManualInvoiceNumberTaken')) return false;
  try {
    let q = supabase
      .from('manual_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('agency_organization_id', agencyOrgId)
      .eq('invoice_number', invoiceNumber);
    if (excludeInvoiceId) q = q.neq('id', excludeInvoiceId);
    const { count, error } = await q;
    if (error) {
      console.error('[isManualInvoiceNumberTaken] error:', error);
      return false;
    }
    return (count ?? 0) > 0;
  } catch (e) {
    console.error('[isManualInvoiceNumberTaken] exception:', e);
    return false;
  }
}

// ── List / fetch ───────────────────────────────────────────────────────────

export type ListManualInvoicesOptions = {
  status?: ManualInvoiceStatus;
  direction?: ManualInvoiceDirection;
  limit?: number;
};

export async function listManualInvoices(
  agencyOrgId: string,
  opts: ListManualInvoicesOptions = {},
): Promise<ManualInvoiceRow[]> {
  if (!assertOrgContext(agencyOrgId, 'listManualInvoices')) return [];
  try {
    let q = supabase
      .from('manual_invoices')
      .select('*')
      .eq('agency_organization_id', agencyOrgId)
      .order('created_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.direction) q = q.eq('direction', opts.direction);
    if (opts.limit && opts.limit > 0) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) {
      console.error('[listManualInvoices] error:', error);
      return [];
    }
    return (data ?? []) as ManualInvoiceRow[];
  } catch (e) {
    console.error('[listManualInvoices] exception:', e);
    return [];
  }
}

export async function getManualInvoiceWithLines(
  invoiceId: string,
): Promise<ManualInvoiceWithLines | null> {
  try {
    const { data, error } = await supabase
      .from('manual_invoices')
      .select('*, line_items:manual_invoice_line_items(*)')
      .eq('id', invoiceId)
      .order('position', { foreignTable: 'manual_invoice_line_items', ascending: true })
      .maybeSingle();
    if (error) {
      console.error('[getManualInvoiceWithLines] error:', error);
      return null;
    }
    if (!data) return null;
    return data as unknown as ManualInvoiceWithLines;
  } catch (e) {
    console.error('[getManualInvoiceWithLines] exception:', e);
    return null;
  }
}

// ── Create / Update header ────────────────────────────────────────────────

export async function createManualInvoiceDraft(
  agencyOrgId: string,
  header: ManualInvoiceHeaderInput,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!assertOrgContext(agencyOrgId, 'createManualInvoiceDraft')) {
    return { ok: false };
  }
  const v = validateDirectionParticipants(header);
  if (v) {
    console.error('[createManualInvoiceDraft] validation failed:', v);
    return { ok: false, reason: v };
  }
  try {
    const body = pruneUndefined({
      ...header,
      currency: (header.currency ?? 'EUR').toUpperCase(),
    });
    const { data, error } = await supabase
      .from('manual_invoices')
      .insert({
        agency_organization_id: agencyOrgId,
        status: 'draft' as ManualInvoiceStatus,
        ...body,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[createManualInvoiceDraft] insert error:', error);
      return { ok: false };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    console.error('[createManualInvoiceDraft] exception:', e);
    return { ok: false };
  }
}

export async function updateManualInvoiceHeader(
  agencyOrgId: string,
  invoiceId: string,
  patch: Partial<ManualInvoiceHeaderInput>,
): Promise<{ ok: boolean; reason?: string }> {
  if (!assertOrgContext(agencyOrgId, 'updateManualInvoiceHeader')) return { ok: false };
  if (
    patch.direction ||
    patch.sender_agency_profile_id !== undefined ||
    patch.sender_counterparty_id !== undefined ||
    patch.recipient_agency_profile_id !== undefined ||
    patch.recipient_counterparty_id !== undefined
  ) {
    // Pull current row, merge, validate.
    const { data: current, error: cErr } = await supabase
      .from('manual_invoices')
      .select(
        'direction, sender_agency_profile_id, sender_counterparty_id, recipient_agency_profile_id, recipient_counterparty_id',
      )
      .eq('id', invoiceId)
      .maybeSingle();
    if (cErr || !current) {
      console.error('[updateManualInvoiceHeader] cannot read current row:', cErr);
      return { ok: false };
    }
    const merged = { ...(current as ManualInvoiceHeaderInput), ...patch };
    const v = validateDirectionParticipants(merged);
    if (v) return { ok: false, reason: v };
  }
  try {
    const body = pruneUndefined({
      ...patch,
      ...(patch.currency ? { currency: patch.currency.toUpperCase() } : {}),
    });
    const { error } = await supabase
      .from('manual_invoices')
      .update(body)
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId);
    if (error) {
      console.error('[updateManualInvoiceHeader] error:', error);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[updateManualInvoiceHeader] exception:', e);
    return { ok: false };
  }
}

// ── Line items ─────────────────────────────────────────────────────────────

function lineInputToRowBody(
  invoiceId: string,
  input: ManualInvoiceLineItemInput,
  fallbackCurrency: string,
): Record<string, unknown> {
  const totals = computeLineTotals(input);
  return {
    invoice_id: invoiceId,
    position: input.position ?? 0,
    category: input.category ?? null,
    is_expense: input.is_expense ?? false,
    description: input.description ?? '',
    notes: input.notes ?? null,
    model_label: input.model_label ?? null,
    job_label: input.job_label ?? null,
    performed_on: input.performed_on ?? null,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? null,
    unit_amount_cents: input.unit_amount_cents ?? 0,
    net_amount_cents: totals.net,
    tax_treatment: input.tax_treatment ?? null,
    tax_rate_percent: input.tax_rate_percent ?? null,
    tax_amount_cents: totals.tax,
    gross_amount_cents: totals.net + totals.tax,
    currency: (input.currency ?? fallbackCurrency).toUpperCase(),
    metadata: input.metadata ?? {},
  };
}

function computeLineTotals(input: ManualInvoiceLineItemInput): {
  net: number;
  tax: number;
} {
  const t = computeManualInvoiceTotals([toLineLike(input)]);
  return { net: t.net_total_before_service_cents, tax: t.tax_total_cents };
}

/**
 * Replace all line items for an invoice in one round-trip-ish flow:
 * 1) delete existing items
 * 2) bulk-insert new items
 *
 * Done sequentially in two awaits — Supabase JS client doesn't support
 * transactions client-side, but the policies require draft-or-generated
 * status which we re-check here.
 */
export async function replaceManualInvoiceLineItems(
  agencyOrgId: string,
  invoiceId: string,
  items: ManualInvoiceLineItemInput[],
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'replaceManualInvoiceLineItems')) return false;
  try {
    // Pull invoice for currency + status check
    const { data: inv, error: invErr } = await supabase
      .from('manual_invoices')
      .select('id, agency_organization_id, currency, status')
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId)
      .maybeSingle();
    if (invErr || !inv) {
      console.error('[replaceManualInvoiceLineItems] invoice not found / not accessible:', invErr);
      return false;
    }
    if ((inv as ManualInvoiceRow).status === 'void') {
      console.error('[replaceManualInvoiceLineItems] invoice is void — refusing to edit');
      return false;
    }

    const fallbackCurrency = (inv as ManualInvoiceRow).currency ?? 'EUR';

    const { error: delErr } = await supabase
      .from('manual_invoice_line_items')
      .delete()
      .eq('invoice_id', invoiceId);
    if (delErr) {
      console.error('[replaceManualInvoiceLineItems] delete error:', delErr);
      return false;
    }

    if (items.length === 0) {
      // Recompute zero totals on header to keep aggregates consistent.
      await refreshManualInvoiceAggregates(agencyOrgId, invoiceId);
      return true;
    }

    const bodies = items.map((it, idx) =>
      lineInputToRowBody(invoiceId, { ...it, position: it.position ?? idx }, fallbackCurrency),
    );
    const { error: insErr } = await supabase.from('manual_invoice_line_items').insert(bodies);
    if (insErr) {
      console.error('[replaceManualInvoiceLineItems] insert error:', insErr);
      return false;
    }

    await refreshManualInvoiceAggregates(agencyOrgId, invoiceId);
    return true;
  } catch (e) {
    console.error('[replaceManualInvoiceLineItems] exception:', e);
    return false;
  }
}

/**
 * Recompute totals from current line items + service charge, and persist
 * the cached aggregates onto the invoice header. Idempotent.
 */
export async function refreshManualInvoiceAggregates(
  agencyOrgId: string,
  invoiceId: string,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'refreshManualInvoiceAggregates')) return false;
  try {
    const { data: inv, error: invErr } = await supabase
      .from('manual_invoices')
      .select('id, service_charge_pct')
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId)
      .maybeSingle();
    if (invErr || !inv) {
      console.error('[refreshManualInvoiceAggregates] invoice not found:', invErr);
      return false;
    }
    const { data: items, error: itErr } = await supabase
      .from('manual_invoice_line_items')
      .select('*')
      .eq('invoice_id', invoiceId);
    if (itErr) {
      console.error('[refreshManualInvoiceAggregates] items error:', itErr);
      return false;
    }
    const totals = computeManualInvoiceTotals(
      ((items ?? []) as ManualInvoiceLineItemRow[]).map((row) => ({
        quantity: Number(row.quantity),
        unit_amount_cents: Number(row.unit_amount_cents),
        tax_rate_percent: row.tax_rate_percent,
        tax_treatment: row.tax_treatment,
        is_expense: row.is_expense,
      })),
      (inv as ManualInvoiceRow).service_charge_pct ?? null,
    );
    const { error: updErr } = await supabase
      .from('manual_invoices')
      .update({
        subtotal_rates_cents: totals.subtotal_rates_cents,
        subtotal_expenses_cents: totals.subtotal_expenses_cents,
        service_charge_cents: totals.service_charge_cents,
        tax_total_cents: totals.tax_total_cents,
        grand_total_cents: totals.grand_total_cents,
        vat_breakdown: totals.vat_breakdown,
      })
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId);
    if (updErr) {
      console.error('[refreshManualInvoiceAggregates] update error:', updErr);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[refreshManualInvoiceAggregates] exception:', e);
    return false;
  }
}

// ── Generate (freeze snapshots, set invoice number, status='generated') ───

function buildSenderSnapshot(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  // We deliberately copy by spread (not by reference) so later mutations on
  // the source profile cannot affect the frozen invoice record.
  return { ...row, _snapshot_at: new Date().toISOString() };
}

export type GenerateManualInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string }
  | { ok: false; reason: string };

/**
 * Freeze profile snapshots, validate participants, ensure invoice number is
 * set + unique, then mark the invoice 'generated'. Idempotent: if already
 * generated, returns { ok:true } without re-snapshotting.
 */
export async function generateManualInvoice(
  agencyOrgId: string,
  invoiceId: string,
  opts: { invoiceNumber?: string; numberPrefix?: string } = {},
): Promise<GenerateManualInvoiceResult> {
  if (!assertOrgContext(agencyOrgId, 'generateManualInvoice')) {
    return { ok: false, reason: 'no_org_context' };
  }
  try {
    const { data: invRaw, error: invErr } = await supabase
      .from('manual_invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId)
      .maybeSingle();
    if (invErr || !invRaw) {
      console.error('[generateManualInvoice] invoice not found:', invErr);
      return { ok: false, reason: 'invoice_not_found' };
    }
    const inv = invRaw as ManualInvoiceRow;

    if (inv.status === 'generated') {
      return { ok: true, invoiceId, invoiceNumber: inv.invoice_number ?? '' };
    }
    if (inv.status === 'void') {
      return { ok: false, reason: 'invoice_void' };
    }

    // Participants must be complete now.
    const v = validateDirectionParticipants(inv, { requireBothSelected: true });
    if (v) return { ok: false, reason: v };

    // Ensure at least one line item exists.
    const { count: lineCount, error: lcErr } = await supabase
      .from('manual_invoice_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', invoiceId);
    if (lcErr) {
      console.error('[generateManualInvoice] line count error:', lcErr);
      return { ok: false, reason: 'line_items_unreadable' };
    }
    if ((lineCount ?? 0) === 0) {
      return { ok: false, reason: 'no_line_items' };
    }

    // Resolve invoice number (caller value > existing > suggestion).
    let invoiceNumber = (opts.invoiceNumber ?? inv.invoice_number ?? '').trim();
    if (!invoiceNumber) {
      const suggested = await suggestNextManualInvoiceNumber(
        agencyOrgId,
        opts.numberPrefix ?? 'INV',
      );
      if (!suggested) return { ok: false, reason: 'cannot_suggest_number' };
      invoiceNumber = suggested;
    }
    const taken = await isManualInvoiceNumberTaken(agencyOrgId, invoiceNumber, invoiceId);
    if (taken) return { ok: false, reason: 'invoice_number_taken' };

    // Snapshot sender + recipient profiles.
    const senderRow =
      inv.sender_agency_profile_id != null
        ? await getManualAgencyBillingProfile(inv.sender_agency_profile_id)
        : inv.sender_counterparty_id != null
          ? await getManualBillingCounterparty(inv.sender_counterparty_id)
          : null;
    const recipientRow =
      inv.recipient_agency_profile_id != null
        ? await getManualAgencyBillingProfile(inv.recipient_agency_profile_id)
        : inv.recipient_counterparty_id != null
          ? await getManualBillingCounterparty(inv.recipient_counterparty_id)
          : null;

    if (!senderRow) return { ok: false, reason: 'sender_profile_unreadable' };
    if (!recipientRow) return { ok: false, reason: 'recipient_profile_unreadable' };

    // Refresh aggregates one last time before freezing so PDF is consistent.
    const aggOk = await refreshManualInvoiceAggregates(agencyOrgId, invoiceId);
    if (!aggOk) return { ok: false, reason: 'aggregate_refresh_failed' };

    const { error: updErr } = await supabase
      .from('manual_invoices')
      .update({
        status: 'generated' as ManualInvoiceStatus,
        invoice_number: invoiceNumber,
        sender_snapshot: buildSenderSnapshot(senderRow as unknown as Record<string, unknown>),
        recipient_snapshot: buildSenderSnapshot(recipientRow as unknown as Record<string, unknown>),
        generated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId);

    if (updErr) {
      // Most likely cause: invoice_number unique conflict due to race.
      console.error('[generateManualInvoice] update error:', updErr);
      const msg = String((updErr as { message?: string }).message ?? '');
      if (msg.includes('uq_manual_invoices_org_number') || msg.includes('duplicate key')) {
        return { ok: false, reason: 'invoice_number_taken' };
      }
      return { ok: false, reason: 'update_failed' };
    }

    return { ok: true, invoiceId, invoiceNumber };
  } catch (e) {
    console.error('[generateManualInvoice] exception:', e);
    return { ok: false, reason: 'exception' };
  }
}

// ── Delete / void ─────────────────────────────────────────────────────────

export async function deleteManualInvoiceDraft(
  agencyOrgId: string,
  invoiceId: string,
): Promise<boolean> {
  if (!assertOrgContext(agencyOrgId, 'deleteManualInvoiceDraft')) return false;
  try {
    const { error } = await supabase
      .from('manual_invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('agency_organization_id', agencyOrgId)
      .eq('status', 'draft');
    if (error) {
      console.error('[deleteManualInvoiceDraft] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteManualInvoiceDraft] exception:', e);
    return false;
  }
}
