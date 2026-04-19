/**
 * Invoices service (B2B Stripe Invoicing).
 *
 * Contract (Hybrid: Option A + ServiceResult):
 * - Most reads/writes follow Option A: returns `boolean` / `null` / `[]` on failure;
 *   never throws in normal flow. UI handlers MUST check the return value
 *   (`if (!ok) rollback`) — `.catch()` alone is dead code.
 * - `sendInvoiceViaStripe` returns a structured `ServiceResult<{hosted_url, pdf_url}>`
 *   shape (`{ ok, error?, hosted_url?, pdf_url? }`) because the Edge Function
 *   needs to surface either Stripe URLs or a typed failure reason. Per `system-invariants.mdc`
 *   "SERVICE LAYER — Option A + ServiceResult (Option C, Hybrid)": one function uses
 *   one contract end-to-end (no mixing within a single function).
 *
 * Permissions (Phase A 2026-11-20 — billing member-write expansion):
 * - Operational members (Owner, Booker, Employee) may: create/edit invoice drafts,
 *   add/update/delete line items, transition draft → pending_send (i.e. send via Stripe).
 * - Owner-only: void invoices, delete drafts, edit organization billing profiles
 *   and defaults. RLS (`20261120_billing_member_write_expansion.sql`) enforces these
 *   boundaries server-side; UI gates mirror them via `isOrganizationOperationalMember`
 *   / `isOrganizationOwner` from `orgRoleTypes.ts`.
 * - All write paths re-confirm org context with `assertOrgContext`.
 *
 * Invariants enforced (see billing-payment-invariants.mdc):
 * - I-PAY-1: DB invoices row is the canonical local truth; Stripe is the payment authority.
 * - I-PAY-3: issuer org boundary — RLS restricts writes to issuer org members
 *   (operational members for drafts/line-items/send; owners for void/delete/profiles/defaults).
 * - I-PAY-10: model billing firewall — models never read/write here.
 */

import { supabase } from '../../lib/supabase';
import { assertOrgContext } from '../utils/orgGuard';
import { logAction } from '../utils/logAction';
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

// ─── Audit helper (Phase B.5 — 20261122) ────────────────────────────────────
// Frontend-initiated invoice mutations write source='api' audit_trail rows.
// We resolve organization_id lazily so callers don't need to pass it explicitly
// for every line-item / status mutation. Trigger-driven status transitions
// (Stripe webhook → tr_invoices_log_status_change) write their own rows with
// source='trigger' independently of this helper.
async function resolveInvoiceOrgId(invoiceId: string): Promise<string | null> {
  if (!invoiceId) return null;
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('organization_id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (error || !data) return null;
    return (data.organization_id as string) ?? null;
  } catch {
    return null;
  }
}

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

    logAction(organizationId, 'createInvoiceDraft', {
      type: 'invoice',
      action: 'invoice_draft_created',
      entityId: newId,
      newData: {
        invoice_type: payload.invoice_type,
        recipient_organization_id: effRecipient,
        currency: effCurrency,
        preset_id: payload.presetId ?? null,
      },
    });

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
    void resolveInvoiceOrgId(invoiceId).then((orgId) => {
      if (orgId) {
        logAction(orgId, 'updateInvoiceDraft', {
          type: 'invoice',
          action: 'invoice_draft_updated',
          entityId: invoiceId,
          newData: update,
        });
      }
    });
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
    // Resolve org_id BEFORE delete (row vanishes after).
    const orgId = await resolveInvoiceOrgId(invoiceId);
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('status', 'draft');
    if (error) {
      console.error('[deleteInvoiceDraft] error:', error);
      return false;
    }
    if (orgId) {
      logAction(orgId, 'deleteInvoiceDraft', {
        type: 'invoice',
        action: 'invoice_draft_deleted',
        entityId: invoiceId,
      });
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
    if (id) {
      await recomputeInvoiceTotals(invoiceId);
      void resolveInvoiceOrgId(invoiceId).then((orgId) => {
        if (orgId) {
          logAction(orgId, 'addInvoiceLineItem', {
            type: 'invoice',
            action: 'invoice_line_added',
            entityId: invoiceId,
            newData: {
              line_item_id: id,
              description: item.description,
              quantity: item.quantity,
              unit_amount_cents: item.unit_amount_cents,
            },
          });
        }
      });
    }
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
    void resolveInvoiceOrgId(invoiceId).then((orgId) => {
      if (orgId) {
        logAction(orgId, 'updateInvoiceLineItem', {
          type: 'invoice',
          action: 'invoice_line_updated',
          entityId: invoiceId,
          newData: { line_item_id: lineItemId, ...update },
        });
      }
    });
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
    void resolveInvoiceOrgId(invoiceId).then((orgId) => {
      if (orgId) {
        logAction(orgId, 'deleteInvoiceLineItem', {
          type: 'invoice',
          action: 'invoice_line_deleted',
          entityId: invoiceId,
          newData: { line_item_id: lineItemId },
        });
      }
    });
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
 * Trigger `send-invoice-via-stripe` Edge Function for a draft invoice.
 *
 * Contract: `ServiceResult`-style (`{ ok, error?, hosted_url?, pdf_url? }`).
 * Caller MUST check `result.ok`; on `false`, `result.error` carries a typed reason
 * (e.g. `not_authenticated`, `not_a_member`, `invoice_not_found`,
 * `invalid_state`/`already_locked`, `recipient_email_required`,
 * `stripe_customer_resolution_failed`, `stripe_create_failed`, `unknown_error`).
 *
 * Edge Function pipeline (Phase B.4 hardening, 2026-11-20):
 * 1. Auth + membership check (operational member of issuer org).
 * 2. Pre-lock CAS: `UPDATE invoices SET status='pending_send' WHERE status='draft'`.
 *    This single-row optimistic lock prevents concurrent sends and avoids gaps in
 *    `invoice_sequences` (we only draw a number AFTER the lock succeeds).
 * 3. Draw `next_invoice_number` and bind `invoice_number` + `billing_profile_snapshot`
 *    + `recipient_billing_snapshot` (allowed by `fn_invoices_freeze_snapshot` while
 *    fields are still NULL on first set, even in `pending_send` state).
 * 4. Resolve / cache Stripe customer (`organization_stripe_customers`).
 * 5. Create Stripe invoice + items + finalize + send (idempotency-key bound to invoice id).
 * 6. Webhook (`stripe-webhook`) syncs `status` (`sent` / `paid` / `payment_failed` / `voided`)
 *    back into the `invoices` row — DB is local truth, Stripe is payment authority (I-PAY-1).
 *
 * Permission boundary: operational members (Owner / Booker / Employee) of the issuer
 * org may invoke this; non-members get `not_a_member`. Models are firewalled out (I-PAY-10).
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
    // Frontend-actor audit: who pressed Send (source='api', user_id=auth.uid()).
    // The DB trigger `tr_invoices_log_status_change` writes a separate row when
    // the Stripe webhook flips status to 'sent' (source='trigger', user_id=NULL)
    // — both entries together give a complete provenance trail.
    void resolveInvoiceOrgId(invoiceId).then((orgId) => {
      if (orgId) {
        logAction(orgId, 'sendInvoiceViaStripe', {
          type: 'invoice',
          action: 'invoice_sent',
          entityId: invoiceId,
          newData: {
            hosted_url: payload.hosted_url ?? null,
            pdf_url: payload.pdf_url ?? null,
          },
        });
      }
    });
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

/**
 * Send a draft (or pending_send) invoice as an HTML e-mail via Resend.
 *
 * Parallel delivery path to {@link sendInvoiceViaStripe}. The Edge Function
 * `send-invoice-via-email` enforces the same Phase B.4 pre-lock semantics
 * (draft → pending_send → sent) so invoice numbers never gap and snapshots
 * freeze atomically. On success the invoice row is marked
 * `delivery_method='email'` and accumulates `email_recipient`,
 * `email_subject`, `email_sent_at`, `email_message_id`. On failure the
 * row stays in `pending_send` (or `draft` if pre-lock failed) and
 * `last_email_failure_at` / `last_email_failure_reason` are set so the
 * Smart Attention pipeline surfaces it.
 *
 * Permission boundary: operational members (Owner / Booker / Employee) of
 * the issuer org may invoke this — same gate as the Stripe send. Models are
 * firewalled (I-PAY-10).
 *
 * Phase E (2026-04-19).
 */
export async function sendInvoiceViaEmail(
  invoiceId: string,
  opts?: {
    /** Override recipient e-mail; defaults to recipient billing profile email. */
    to?: string;
    /** Optional CC recipients (operator BCC themselves, etc.). */
    cc?: string[];
    /** Optional subject override. */
    subject?: string;
    /** Optional free-form message rendered above the invoice block. */
    message?: string;
  },
): Promise<{
  ok: boolean;
  error?: string;
  invoice_number?: string;
  email_message_id?: string | null;
  to?: string;
}> {
  if (!invoiceId) return { ok: false, error: 'invoice_id required' };
  try {
    const { data, error } = await supabase.functions.invoke('send-invoice-via-email', {
      body: {
        invoice_id: invoiceId,
        to: opts?.to,
        cc: opts?.cc,
        subject: opts?.subject,
        message: opts?.message,
      },
    });
    if (error) {
      console.error('[sendInvoiceViaEmail] invoke error:', error);
      return { ok: false, error: error.message };
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      invoice_number?: string;
      email_message_id?: string | null;
      to?: string;
    };
    if (!payload.ok) {
      return { ok: false, error: payload.error ?? 'unknown_error' };
    }
    // Frontend-actor audit (parity with sendInvoiceViaStripe). The DB trigger
    // `tr_invoices_log_status_change` adds a second row when status flips to
    // 'sent' (source='trigger') — together they give a complete trail.
    void resolveInvoiceOrgId(invoiceId).then((orgId) => {
      if (orgId) {
        logAction(orgId, 'sendInvoiceViaEmail', {
          type: 'invoice',
          action: 'invoice_sent',
          entityId: invoiceId,
          newData: {
            delivery_method: 'email',
            to: payload.to ?? null,
            email_message_id: payload.email_message_id ?? null,
          },
        });
      }
    });
    return {
      ok: true,
      invoice_number: payload.invoice_number,
      email_message_id: payload.email_message_id ?? null,
      to: payload.to,
    };
  } catch (e) {
    console.error('[sendInvoiceViaEmail] exception:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'exception' };
  }
}
