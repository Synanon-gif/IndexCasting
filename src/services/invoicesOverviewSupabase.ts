/**
 * invoicesOverviewSupabase.ts — Unified Invoice Overview service.
 *
 * Adds a third, READ-ONLY surface that aggregates rows from BOTH:
 *   * public.invoices         (Stripe-routed B2B; see invoicesSupabase.ts)
 *   * public.manual_invoices  (manual PDFs; see manualInvoicesSupabase.ts)
 *
 * It exposes a small operator-internal "tracking" overlay (open / paid / problem
 * + short note) stored in `public.invoice_overview_metadata`. The overlay is
 * INDEPENDENT of underlying invoice / Stripe state — it is purely for internal
 * bookkeeping in the unified Invoice Overview UI.
 *
 * Boundaries (mirrors source-table RLS posture exactly):
 *   * Reads: SECURITY DEFINER RPC `list_invoice_overview` checks
 *     `public.is_org_member(p_organization_id)` OR (for client recipients)
 *     `public.is_org_owner(p_organization_id)` and ALSO restricts the
 *     unified rows to the same WHERE filter the source-table RLS would apply.
 *   * Writes: SECURITY DEFINER RPCs `update_invoice_tracking_status` and
 *     `update_invoice_tracking_note` only accept (source_type, source_id) and
 *     re-resolve the owning org server-side via `fn_resolve_invoice_owning_org`.
 *     Membership is then re-checked. The frontend never decides org/role.
 *
 * Contract: Option A — never throws in normal flow. Returns [] / null / false
 * on error, logs to console.
 *
 * Audit: every successful tracking update writes `audit_trail` via the
 * `log_invoice_tracking_audit` SECDEF helper (source='rpc'). The note text
 * itself is NOT logged — only `had_note`/`has_note`/length — to keep audit
 * rows compact.
 */

import { supabase } from '../../lib/supabase';
import { isSafeInvoiceOverviewExternalUrl } from '../utils/invoiceOverviewExternalUrl';
import { assertOrgContext } from '../utils/orgGuard';
import type {
  InvoiceOverviewFilters,
  InvoiceOverviewRow,
  InvoiceOverviewSourceType,
  InvoiceOverviewTrackingStatus,
} from '../types/invoiceOverviewTypes';

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listInvoiceOverview(
  organizationId: string,
  filters?: InvoiceOverviewFilters,
): Promise<InvoiceOverviewRow[]> {
  if (!assertOrgContext(organizationId, 'listInvoiceOverview')) return [];
  try {
    const { data, error } = await supabase.rpc('list_invoice_overview', {
      p_organization_id: organizationId,
      p_year: filters?.year ?? null,
      p_month: filters?.month ?? null,
      p_direction: filters?.direction ?? null,
      p_source_type: filters?.sourceType ?? null,
      p_tracking_status: filters?.trackingStatus ?? null,
      p_search: filters?.search ?? null,
      p_limit: clampLimit(filters?.limit),
      p_offset: clampOffset(filters?.offset),
    });
    if (error) {
      console.error('[listInvoiceOverview] error:', error);
      return [];
    }
    return ((data ?? []) as RawOverviewRow[]).map(normalizeRow);
  } catch (e) {
    console.error('[listInvoiceOverview] exception:', e);
    return [];
  }
}

// ─── Writes (operator-internal tracking overlay) ────────────────────────────

export async function updateInvoiceTrackingStatus(
  sourceType: InvoiceOverviewSourceType,
  sourceId: string,
  status: InvoiceOverviewTrackingStatus,
): Promise<boolean> {
  if (!sourceId) return false;
  if (sourceType !== 'system' && sourceType !== 'manual') return false;
  if (status !== 'open' && status !== 'paid' && status !== 'problem') return false;
  try {
    const { data, error } = await supabase.rpc('update_invoice_tracking_status', {
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_status: status,
    });
    if (error) {
      console.error('[updateInvoiceTrackingStatus] error:', error);
      return false;
    }
    const ok = (data as { ok?: boolean } | null)?.ok === true;
    return ok;
  } catch (e) {
    console.error('[updateInvoiceTrackingStatus] exception:', e);
    return false;
  }
}

export async function updateInvoiceTrackingNote(
  sourceType: InvoiceOverviewSourceType,
  sourceId: string,
  note: string | null,
): Promise<boolean> {
  if (!sourceId) return false;
  if (sourceType !== 'system' && sourceType !== 'manual') return false;
  const trimmed = (note ?? '').trim();
  if (trimmed.length > 1000) return false;
  try {
    const { data, error } = await supabase.rpc('update_invoice_tracking_note', {
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_note: trimmed.length === 0 ? null : trimmed,
    });
    if (error) {
      console.error('[updateInvoiceTrackingNote] error:', error);
      return false;
    }
    const ok = (data as { ok?: boolean } | null)?.ok === true;
    return ok;
  } catch (e) {
    console.error('[updateInvoiceTrackingNote] exception:', e);
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampLimit(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.floor(value), 1), 500);
}

function clampOffset(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(Math.floor(value), 0);
}

type RawOverviewRow = {
  source_type: string;
  source_id: string;
  organization_id: string;
  invoice_number: string | null;
  direction: string | null;
  source_status: string | null;
  tracking_status: string | null;
  internal_note: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  total_amount_cents: number | string | null;
  sender_name: string | null;
  recipient_name: string | null;
  client_name: string | null;
  model_name: string | null;
  reference_label: string | null;
  has_payment_problem: boolean | null;
  source_created_at: string | null;
  metadata_updated_at: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf_url?: string | null;
};

function normalizeRow(row: RawOverviewRow): InvoiceOverviewRow {
  return {
    sourceType: row.source_type === 'manual' ? 'manual' : 'system',
    sourceId: row.source_id,
    organizationId: row.organization_id,
    invoiceNumber: row.invoice_number,
    direction: (row.direction ?? 'agency_to_client') as InvoiceOverviewRow['direction'],
    sourceStatus: row.source_status ?? null,
    trackingStatus: normalizeTrackingStatus(row.tracking_status),
    internalNote: row.internal_note ?? null,
    invoiceDate: row.invoice_date ?? null,
    dueDate: row.due_date ?? null,
    currency: row.currency ?? 'EUR',
    totalAmountCents: toNumber(row.total_amount_cents),
    senderName: row.sender_name ?? null,
    recipientName: row.recipient_name ?? null,
    clientName: row.client_name ?? null,
    modelName: row.model_name ?? null,
    referenceLabel: row.reference_label ?? null,
    hasPaymentProblem: row.has_payment_problem === true,
    sourceCreatedAt: row.source_created_at,
    metadataUpdatedAt: row.metadata_updated_at,
    hostedInvoiceUrl: sanitizeOverviewUrl(row.hosted_invoice_url),
    invoicePdfUrl: sanitizeOverviewUrl(row.invoice_pdf_url),
  };
}

function sanitizeOverviewUrl(value: string | null | undefined): string | null {
  if (value == null || typeof value !== 'string') return null;
  const t = value.trim();
  return isSafeInvoiceOverviewExternalUrl(t) ? t : null;
}

function normalizeTrackingStatus(value: string | null | undefined): InvoiceOverviewTrackingStatus {
  if (value === 'paid' || value === 'open' || value === 'problem') return value;
  return 'open';
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
