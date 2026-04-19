/**
 * Invoices service (B2B Stripe Invoicing).
 *
 * Contract:
 * - Option A return pattern: returns boolean / null / [] on failure; never throws in normal flow.
 * - Owner-only writes (RLS-enforced server-side; UI must also gate via canEditBilling()).
 * - All write paths re-confirm org context with assertOrgContext.
 *
 * Invariants enforced (see billing-payment-invariants.mdc):
 * - I-PAY-1: DB invoices row is the canonical local truth; Stripe is the payment authority.
 * - I-PAY-3: writes restricted to issuer org owners (RLS).
 * - I-PAY-10: model billing firewall — models never read/write here.
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  AgencyClientBillingPresetRow,
  InvoiceDraftPatch,
  InvoiceLineItemInput,
  InvoiceLineItemRow,
  InvoiceRow,
  InvoiceStatus,
  InvoiceType,
  InvoiceWithLines,
} from '../types/billingTypes';

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * List invoices issued by an organization (caller must be a member; RLS enforces).
 * Optionally filter by status set (e.g. ['draft'] or ['sent','overdue']).
 */
export async function listInvoicesForOrganization(
  organizationId: string,
  opts?: {
    statuses?: InvoiceStatus[];
    types?: InvoiceType[];
    limit?: number;
    /**
     * Cursor pagination — pass the `created_at` of the last row from the previous
     * page to fetch older rows. Combined with `cursorId` for stable tie-breaking
     * when multiple rows share the same `created_at`.
     */
    cursorCreatedAt?: string | null;
    cursorId?: string | null;
  },
): Promise<InvoiceRow[]> {
  if (!assertOrgContext(organizationId, 'listInvoicesForOrganization')) return [];
  try {
    let q = supabase
      .from('invoices')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.statuses?.length) q = q.in('status', opts.statuses);
    if (opts?.types?.length) q = q.in('invoice_type', opts.types);
    if (opts?.cursorCreatedAt) {
      // Keyset pagination: fetch rows strictly older than the cursor. Use OR
      // clause for stable tie-breaking on identical created_at timestamps.
      if (opts.cursorId) {
        q = q.or(
          `created_at.lt.${opts.cursorCreatedAt},and(created_at.eq.${opts.cursorCreatedAt},id.lt.${opts.cursorId})`,
        );
      } else {
        q = q.lt('created_at', opts.cursorCreatedAt);
      }
    }
    const { data, error } = await q;
    if (error) {
      console.error('[listInvoicesForOrganization] error:', error);
      return [];
    }
    return (data ?? []) as InvoiceRow[];
  } catch (e) {
    console.error('[listInvoicesForOrganization] exception:', e);
    return [];
  }
}

/**
 * List invoices addressed TO an organization as recipient (e.g. a client receiving
 * agency invoices, an agency receiving platform commission invoices). RLS only
 * exposes rows in non-draft statuses.
 */
export async function listInvoicesForRecipient(
  organizationId: string,
  opts?: {
    statuses?: InvoiceStatus[];
    types?: InvoiceType[];
    limit?: number;
    cursorCreatedAt?: string | null;
    cursorId?: string | null;
  },
): Promise<InvoiceRow[]> {
  if (!assertOrgContext(organizationId, 'listInvoicesForRecipient')) return [];
  try {
    let q = supabase
      .from('invoices')
      .select('*')
      .eq('recipient_organization_id', organizationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.statuses?.length) q = q.in('status', opts.statuses);
    if (opts?.types?.length) q = q.in('invoice_type', opts.types);
    if (opts?.cursorCreatedAt) {
      if (opts.cursorId) {
        q = q.or(
          `created_at.lt.${opts.cursorCreatedAt},and(created_at.eq.${opts.cursorCreatedAt},id.lt.${opts.cursorId})`,
        );
      } else {
        q = q.lt('created_at', opts.cursorCreatedAt);
      }
    }
    const { data, error } = await q;
    if (error) {
      console.error('[listInvoicesForRecipient] error:', error);
      return [];
    }
    return (data ?? []) as InvoiceRow[];
  } catch (e) {
    console.error('[listInvoicesForRecipient] exception:', e);
    return [];
  }
}

export async function getInvoiceWithLines(invoiceId: string): Promise<InvoiceWithLines | null> {
  if (!invoiceId) return null;
  try {
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invErr) {
      console.error('[getInvoiceWithLines] invoice error:', invErr);
      return null;
    }
    if (!invoice) return null;
    const { data: lines, error: lineErr } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('position', { ascending: true });
    if (lineErr) {
      console.error('[getInvoiceWithLines] lines error:', lineErr);
      return null;
    }
    return {
      ...(invoice as InvoiceRow),
      line_items: (lines ?? []) as InvoiceLineItemRow[],
    };
  } catch (e) {
    console.error('[getInvoiceWithLines] exception:', e);
    return null;
  }
}

// ─── Owner writes (drafts only; RLS enforces ownership server-side) ─────────

/**
 * Create a manual draft invoice (e.g. ad-hoc agency_to_client / agency_to_agency
 * outside the auto-trigger path).
 *
 * Preset prefill (optional, opt-in via `presetId`):
 * - Loaded preset values are used as DEFAULTS; explicit `payload` fields ALWAYS win.
 * - Preset is one-shot: it pre-fills the draft AT CREATION ONLY. The resulting
 *   invoice row stays canonical (immutable snapshot freeze applies on send).
 * - `default_line_item_template` items are inserted as initial line items and
 *   recomputeInvoiceTotals() runs once at the end. Fails on individual line items
 *   are logged but do not roll back the invoice insert (best-effort prefill).
 *
 * Returns the new invoice id, or null on failure.
 */
export async function createInvoiceDraft(
  organizationId: string,
  payload: {
    invoice_type: InvoiceType;
    recipient_organization_id?: string | null;
    currency?: string;
    notes?: string | null;
    due_date?: string | null;
    source_option_request_id?: string | null;
    tax_rate_percent?: number | null;
    tax_mode?: 'manual' | 'stripe_tax';
    reverse_charge_applied?: boolean;
    presetId?: string | null;
  },
): Promise<string | null> {
  if (!assertOrgContext(organizationId, 'createInvoiceDraft')) return null;
  try {
    let preset: AgencyClientBillingPresetRow | null = null;
    if (payload.presetId) {
      const { data: presetData, error: presetErr } = await supabase
        .from('agency_client_billing_presets')
        .select('*')
        .eq('id', payload.presetId)
        .eq('agency_organization_id', organizationId)
        .maybeSingle();
      if (presetErr) {
        console.error('[createInvoiceDraft] preset lookup error:', presetErr);
        // Best-effort: continue without preset if lookup fails.
      } else if (presetData) {
        preset = presetData as AgencyClientBillingPresetRow;
      }
    }

    // Resolve effective fields: explicit payload wins; preset defaults fill gaps.
    const effRecipient =
      payload.recipient_organization_id !== undefined
        ? payload.recipient_organization_id
        : (preset?.client_organization_id ?? null);
    const effCurrency = payload.currency ?? preset?.default_currency ?? 'EUR';
    const effTaxMode = payload.tax_mode ?? preset?.default_tax_mode ?? 'manual';
    const effTaxRate =
      payload.tax_rate_percent !== undefined
        ? payload.tax_rate_percent
        : (preset?.default_tax_rate_percent ?? null);
    const effReverseCharge =
      payload.reverse_charge_applied !== undefined
        ? payload.reverse_charge_applied
        : (preset?.default_reverse_charge ?? false);
    const effNotes = payload.notes !== undefined ? payload.notes : (preset?.default_notes ?? null);
    let effDueDate = payload.due_date ?? null;
    if (effDueDate === null && preset?.default_payment_terms_days) {
      const d = new Date();
      d.setDate(d.getDate() + Number(preset.default_payment_terms_days));
      effDueDate = d.toISOString().slice(0, 10);
    }

    const { data, error } = await supabase
      .from('invoices')
      .insert({
        organization_id: organizationId,
        recipient_organization_id: effRecipient,
        invoice_type: payload.invoice_type,
        status: 'draft',
        currency: effCurrency,
        notes: effNotes,
        due_date: effDueDate,
        source_option_request_id: payload.source_option_request_id ?? null,
        tax_rate_percent: effTaxRate,
        tax_mode: effTaxMode,
        reverse_charge_applied: effReverseCharge,
        subtotal_amount_cents: 0,
        tax_amount_cents: 0,
        total_amount_cents: 0,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[createInvoiceDraft] error:', error);
      return null;
    }
    const newId = (data?.id as string) ?? null;
    if (!newId) return null;

    // Insert preset line item template items (best-effort) if present.
    if (preset && Array.isArray(preset.default_line_item_template)) {
      const template = preset.default_line_item_template;
      let position = 0;
      let insertedAny = false;
      for (const raw of template) {
        const itemRaw = raw as Record<string, unknown>;
        const description =
          typeof itemRaw.description === 'string' ? (itemRaw.description as string) : null;
        if (!description) continue;
        const quantity = typeof itemRaw.quantity === 'number' ? Number(itemRaw.quantity) : 1;
        const unitAmount =
          typeof itemRaw.unit_amount_cents === 'number' ? Number(itemRaw.unit_amount_cents) : 0;
        const total = Math.round(quantity * unitAmount);
        const { error: liErr } = await supabase.from('invoice_line_items').insert({
          invoice_id: newId,
          description,
          quantity,
          unit_amount_cents: unitAmount,
          total_amount_cents: total,
          currency: effCurrency,
          position,
          metadata: {},
        });
        if (liErr) {
          console.error('[createInvoiceDraft] template line item insert error:', liErr);
        } else {
          insertedAny = true;
          position += 1;
        }
      }
      if (insertedAny) {
        await recomputeInvoiceTotals(newId);
      }
    }

    return newId;
  } catch (e) {
    console.error('[createInvoiceDraft] exception:', e);
    return null;
  }
}

/** Update top-level draft fields (status must remain 'draft' on the row). */
export async function updateInvoiceDraft(
  invoiceId: string,
  patch: InvoiceDraftPatch,
): Promise<boolean> {
  if (!invoiceId) return false;
  try {
    const update: Record<string, unknown> = {};
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.due_date !== undefined) update.due_date = patch.due_date;
    if (patch.currency !== undefined) update.currency = patch.currency ?? 'EUR';
    if (patch.tax_rate_percent !== undefined) update.tax_rate_percent = patch.tax_rate_percent;
    if (patch.tax_mode !== undefined && patch.tax_mode !== null) update.tax_mode = patch.tax_mode;
    if (patch.reverse_charge_applied !== undefined) {
      update.reverse_charge_applied = patch.reverse_charge_applied ?? false;
    }
    if (patch.recipient_organization_id !== undefined) {
      update.recipient_organization_id = patch.recipient_organization_id;
    }
    if (Object.keys(update).length === 0) return true;
    const { error } = await supabase
      .from('invoices')
      .update(update)
      .eq('id', invoiceId)
      .eq('status', 'draft');
    if (error) {
      console.error('[updateInvoiceDraft] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[updateInvoiceDraft] exception:', e);
    return false;
  }
}

/** Delete a draft invoice (RLS: owner only, status='draft' only). */
export async function deleteInvoiceDraft(invoiceId: string): Promise<boolean> {
  if (!invoiceId) return false;
  try {
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('status', 'draft');
    if (error) {
      console.error('[deleteInvoiceDraft] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[deleteInvoiceDraft] exception:', e);
    return false;
  }
}

// ─── Line items ─────────────────────────────────────────────────────────────

export async function addInvoiceLineItem(
  invoiceId: string,
  item: InvoiceLineItemInput,
): Promise<string | null> {
  if (!invoiceId) return null;
  try {
    const total = item.total_amount_cents ?? Math.round(item.quantity * item.unit_amount_cents);
    const { data, error } = await supabase
      .from('invoice_line_items')
      .insert({
        invoice_id: invoiceId,
        description: item.description,
        quantity: item.quantity,
        unit_amount_cents: item.unit_amount_cents,
        total_amount_cents: total,
        currency: item.currency ?? 'EUR',
        position: item.position ?? 0,
        metadata: item.metadata ?? {},
        source_option_request_id: item.source_option_request_id ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[addInvoiceLineItem] error:', error);
      return null;
    }
    const id = (data?.id as string) ?? null;
    if (id) await recomputeInvoiceTotals(invoiceId);
    return id;
  } catch (e) {
    console.error('[addInvoiceLineItem] exception:', e);
    return null;
  }
}

export async function updateInvoiceLineItem(
  lineItemId: string,
  invoiceId: string,
  patch: Partial<InvoiceLineItemInput>,
): Promise<boolean> {
  if (!lineItemId || !invoiceId) return false;
  try {
    const update: Record<string, unknown> = {};
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.quantity !== undefined) update.quantity = patch.quantity;
    if (patch.unit_amount_cents !== undefined) update.unit_amount_cents = patch.unit_amount_cents;
    if (patch.currency !== undefined) update.currency = patch.currency ?? 'EUR';
    if (patch.position !== undefined) update.position = patch.position;
    if (patch.metadata !== undefined) update.metadata = patch.metadata;
    if (patch.source_option_request_id !== undefined) {
      update.source_option_request_id = patch.source_option_request_id;
    }
    if (patch.quantity !== undefined || patch.unit_amount_cents !== undefined) {
      // Recompute line total if either factor changed and explicit total not provided.
      if (patch.total_amount_cents === undefined) {
        // Need fresh quantities for recompute.
        const { data: row } = await supabase
          .from('invoice_line_items')
          .select('quantity, unit_amount_cents')
          .eq('id', lineItemId)
          .maybeSingle();
        const q = patch.quantity ?? Number(row?.quantity ?? 1);
        const unit = patch.unit_amount_cents ?? Number(row?.unit_amount_cents ?? 0);
        update.total_amount_cents = Math.round(q * unit);
      } else {
        update.total_amount_cents = patch.total_amount_cents;
      }
    } else if (patch.total_amount_cents !== undefined) {
      update.total_amount_cents = patch.total_amount_cents;
    }
    const { error } = await supabase
      .from('invoice_line_items')
      .update(update)
      .eq('id', lineItemId)
      .eq('invoice_id', invoiceId);
    if (error) {
      console.error('[updateInvoiceLineItem] error:', error);
      return false;
    }
    await recomputeInvoiceTotals(invoiceId);
    return true;
  } catch (e) {
    console.error('[updateInvoiceLineItem] exception:', e);
    return false;
  }
}

export async function deleteInvoiceLineItem(
  lineItemId: string,
  invoiceId: string,
): Promise<boolean> {
  if (!lineItemId || !invoiceId) return false;
  try {
    const { error } = await supabase
      .from('invoice_line_items')
      .delete()
      .eq('id', lineItemId)
      .eq('invoice_id', invoiceId);
    if (error) {
      console.error('[deleteInvoiceLineItem] error:', error);
      return false;
    }
    await recomputeInvoiceTotals(invoiceId);
    return true;
  } catch (e) {
    console.error('[deleteInvoiceLineItem] exception:', e);
    return false;
  }
}

/**
 * Re-sum subtotal/tax/total from current line items + tax_rate_percent.
 * Best-effort; called automatically after add/update/delete line item.
 */
export async function recomputeInvoiceTotals(invoiceId: string): Promise<boolean> {
  if (!invoiceId) return false;
  try {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, status, tax_rate_percent, tax_mode, reverse_charge_applied')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!invoice || invoice.status !== 'draft') return true; // never recompute non-drafts

    const { data: lines } = await supabase
      .from('invoice_line_items')
      .select('total_amount_cents')
      .eq('invoice_id', invoiceId);
    const subtotal = (lines ?? []).reduce(
      (acc: number, r: { total_amount_cents: number | null }) =>
        acc + Number(r.total_amount_cents ?? 0),
      0,
    );
    const taxRate = Number(invoice.tax_rate_percent ?? 0);
    const reverseCharge = invoice.reverse_charge_applied === true;
    const useStripeTax = invoice.tax_mode === 'stripe_tax';
    // Manual tax only; if stripe_tax or reverse_charge: leave tax to Stripe / 0.
    const tax =
      !reverseCharge && !useStripeTax && taxRate > 0 ? Math.round((subtotal * taxRate) / 100) : 0;
    const total = subtotal + tax;
    const { error } = await supabase
      .from('invoices')
      .update({
        subtotal_amount_cents: subtotal,
        tax_amount_cents: tax,
        total_amount_cents: total,
      })
      .eq('id', invoiceId)
      .eq('status', 'draft');
    if (error) {
      console.error('[recomputeInvoiceTotals] error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[recomputeInvoiceTotals] exception:', e);
    return false;
  }
}

// ─── Send via Stripe (Edge Function) ────────────────────────────────────────

/**
 * Trigger send-invoice-via-stripe Edge Function for a draft invoice.
 * The Edge Function handles: numbering, billing snapshots, Stripe customer
 * resolution, Stripe invoice + items + finalize + send.
 */
export async function sendInvoiceViaStripe(invoiceId: string): Promise<{
  ok: boolean;
  error?: string;
  hosted_url?: string | null;
  pdf_url?: string | null;
}> {
  if (!invoiceId) return { ok: false, error: 'invoice_id required' };
  try {
    const { data, error } = await supabase.functions.invoke('send-invoice-via-stripe', {
      body: { invoice_id: invoiceId },
    });
    if (error) {
      console.error('[sendInvoiceViaStripe] invoke error:', error);
      return { ok: false, error: error.message };
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      hosted_url?: string | null;
      pdf_url?: string | null;
    };
    if (!payload.ok) {
      return { ok: false, error: payload.error ?? 'unknown_error' };
    }
    return {
      ok: true,
      hosted_url: payload.hosted_url ?? null,
      pdf_url: payload.pdf_url ?? null,
    };
  } catch (e) {
    console.error('[sendInvoiceViaStripe] exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'exception' };
  }
}
