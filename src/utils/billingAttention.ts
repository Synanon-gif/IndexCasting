/**
 * Billing Smart Attention pipeline.
 *
 * Mirrors the design philosophy of optionRequestAttention.ts: a single canonical
 * derivation pipeline drives every UI surface that signals billing-related action
 * required (Billing tab badge, BillingHubView header banner, dashboard widget).
 *
 * Categories (11):
 *   1. invoice_overdue                — sent invoice past due_date, not paid
 *   2. invoice_unpaid                 — sent invoice not yet paid (within terms)
 *   3. invoice_draft_pending          — draft invoice never sent
 *   4. invoice_pending_send           — pending_send transient state stuck
 *   5. invoice_payment_failed         — Stripe reported payment_failed (20261123)
 *   6. invoice_missing_recipient_data — draft has total>0 but no recipient billing
 *                                       data (would be blocked at send time)
 *   7. invoice_received_unpaid        — recipient sees an unpaid bill
 *   8. invoice_received_overdue       — recipient sees an overdue bill
 *   9. settlement_draft_pending       — agency-internal settlement still draft
 *  10. settlement_recorded_unpaid     — recorded settlement not yet paid
 *  11. billing_profile_missing        — issuer org has no billing profile yet
 *
 * Severity tiers:
 *   - critical : overdue (issuer or recipient), pending_send stuck,
 *                payment_failed (Stripe charge declined — operational alert)
 *   - high     : unpaid, received_unpaid, billing_profile_missing,
 *                missing_recipient_data (would block send)
 *   - medium   : draft_pending, settlement_recorded_unpaid
 *   - low      : settlement_draft_pending
 *
 * Role visibility:
 *   - issuer  : signals about invoices the org issued (organization_id = me)
 *   - recipient: signals about invoices addressed to me (recipient_organization_id = me)
 *   - issuer_internal: agency-only settlements / billing profile gaps
 *
 * The pipeline is pure: it takes denormalized billing snapshots and returns
 * `BillingAttentionSignal[]`. It performs no DB calls; callers must pre-load.
 *
 * This module is independent from existing optionRequestAttention so changes
 * here cannot regress option/casting/job lifecycle attention.
 */

import type { InvoiceRow, AgencyModelSettlementRow } from '../types/billingTypes';

export type BillingAttentionCategory =
  | 'invoice_overdue'
  | 'invoice_unpaid'
  | 'invoice_draft_pending'
  | 'invoice_pending_send'
  | 'invoice_payment_failed'
  | 'invoice_missing_recipient_data'
  | 'invoice_received_unpaid'
  | 'invoice_received_overdue'
  | 'settlement_draft_pending'
  | 'settlement_recorded_unpaid'
  | 'billing_profile_missing';

export type BillingAttentionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type BillingAttentionRole =
  | 'agency_owner'
  | 'agency_member'
  | 'client_owner'
  | 'client_member';

export type BillingAttentionSignal = {
  category: BillingAttentionCategory;
  severity: BillingAttentionSeverity;
  /** Source row id (invoice id, settlement id, or `'org:<id>'` for org-level). */
  sourceId: string;
  /** Optional invoice/settlement number for UI display. */
  displayNumber?: string | null;
  /** Optional cents amount for UI display. */
  amountCents?: number | null;
  currency?: string | null;
  /** Optional ISO date string (due / overdue date). */
  date?: string | null;
};

export type BillingAttentionInput = {
  /** Invoices the org issued (organization_id = me). */
  issuedInvoices?: InvoiceRow[];
  /** Invoices the org received (recipient_organization_id = me). */
  receivedInvoices?: InvoiceRow[];
  /** Agency settlements (agency-internal only — never for clients/models). */
  settlements?: AgencyModelSettlementRow[];
  /** True if the org has at least one billing profile row. */
  hasBillingProfile?: boolean;
  /** Today (ISO YYYY-MM-DD). Defaults to current date. Tests inject for determinism. */
  today?: string;
  /**
   * "Stuck" threshold for pending_send (minutes). After this many minutes since
   * `updated_at`, a pending_send row counts as critical (Stripe webhook gap).
   */
  pendingSendStuckMinutes?: number;
};

const SEVERITY_RANK: Record<BillingAttentionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const CATEGORY_SEVERITY: Record<BillingAttentionCategory, BillingAttentionSeverity> = {
  invoice_overdue: 'critical',
  invoice_pending_send: 'critical',
  invoice_received_overdue: 'critical',
  invoice_payment_failed: 'critical',
  invoice_unpaid: 'high',
  invoice_received_unpaid: 'high',
  billing_profile_missing: 'high',
  invoice_missing_recipient_data: 'high',
  invoice_draft_pending: 'medium',
  settlement_recorded_unpaid: 'medium',
  settlement_draft_pending: 'low',
};

/**
 * Required recipient billing fields. Mirrors the validation that
 * send-invoice-via-stripe enforces just before drawing an invoice number.
 *
 * If a draft has total>0 but is missing one of these fields in the recipient
 * snapshot (or has no snapshot at all), it would fail at send time. Surfacing
 * this early in Smart Attention lets the user fix it before the send attempt.
 */
const REQUIRED_RECIPIENT_FIELDS = [
  'billing_name',
  'billing_address_1',
  'billing_city',
  'billing_country',
  'billing_email',
] as const;

function recipientSnapshotIsComplete(
  snapshot: Record<string, unknown> | null | undefined,
): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  for (const field of REQUIRED_RECIPIENT_FIELDS) {
    const v = (snapshot as Record<string, unknown>)[field];
    if (typeof v !== 'string' || v.trim() === '') return false;
  }
  return true;
}

function todayDate(today?: string): Date {
  if (today) {
    const d = new Date(`${today}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function isOverdue(dueDate: string | null, today?: string): boolean {
  if (!dueDate) return false;
  const due = new Date(`${dueDate}T23:59:59Z`);
  if (Number.isNaN(due.getTime())) return false;
  return todayDate(today).getTime() > due.getTime();
}

function minutesSince(iso: string | null, ref: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (ref.getTime() - t) / 60000);
}

/**
 * Derive billing attention signals for an organization.
 *
 * Returned list is deduplicated and sorted by severity (critical first).
 * Empty input → empty array. Pure function; safe to call in render.
 */
export function deriveBillingAttention(input: BillingAttentionInput): BillingAttentionSignal[] {
  const signals: BillingAttentionSignal[] = [];
  const today = input.today;
  const stuckMin = input.pendingSendStuckMinutes ?? 30;
  const now = todayDate(today);

  // ─── Issued invoices ──────────────────────────────────────────────────────
  for (const inv of input.issuedInvoices ?? []) {
    // 20261123 — Stripe payment_failed is a CRITICAL operational alert that
    // is INDEPENDENT of the canonical lifecycle status. A `sent` or `overdue`
    // invoice can also have a recent Stripe failure (card decline). We surface
    // it as its own signal IN ADDITION TO any status-based signal, but only
    // while the failure is still "open" (status not in paid/void/uncollectible).
    if (
      inv.last_stripe_failure_at &&
      inv.status !== 'paid' &&
      inv.status !== 'void' &&
      inv.status !== 'uncollectible'
    ) {
      signals.push({
        category: 'invoice_payment_failed',
        severity: CATEGORY_SEVERITY.invoice_payment_failed,
        sourceId: inv.id,
        displayNumber: inv.invoice_number,
        amountCents: inv.total_amount_cents,
        currency: inv.currency,
        date: inv.last_stripe_failure_at,
      });
    }

    if (inv.status === 'sent') {
      if (isOverdue(inv.due_date, today)) {
        signals.push({
          category: 'invoice_overdue',
          severity: CATEGORY_SEVERITY.invoice_overdue,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
          date: inv.due_date,
        });
      } else {
        signals.push({
          category: 'invoice_unpaid',
          severity: CATEGORY_SEVERITY.invoice_unpaid,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
          date: inv.due_date,
        });
      }
      continue;
    }
    if (inv.status === 'overdue') {
      signals.push({
        category: 'invoice_overdue',
        severity: CATEGORY_SEVERITY.invoice_overdue,
        sourceId: inv.id,
        displayNumber: inv.invoice_number,
        amountCents: inv.total_amount_cents,
        currency: inv.currency,
        date: inv.due_date,
      });
      continue;
    }
    if (inv.status === 'pending_send') {
      // Only signal as stuck if pending_send has been sitting too long.
      if (minutesSince(inv.updated_at, now) >= stuckMin) {
        signals.push({
          category: 'invoice_pending_send',
          severity: CATEGORY_SEVERITY.invoice_pending_send,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
        });
      }
      continue;
    }
    if (inv.status === 'draft') {
      // Only flag drafts that have line items / non-zero total — empty drafts
      // are intentional scratchpad state and would be noisy.
      if ((inv.total_amount_cents ?? 0) > 0) {
        signals.push({
          category: 'invoice_draft_pending',
          severity: CATEGORY_SEVERITY.invoice_draft_pending,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
        });
        // 20261123 — Pre-flight recipient-data check. A draft with non-zero
        // total that has no recipient_billing_snapshot (or one missing
        // required fields) would fail at send-invoice-via-stripe time. We
        // surface this as a separate HIGH signal so accounting can fix the
        // recipient data before clicking Send and getting a confusing error.
        if (!recipientSnapshotIsComplete(inv.recipient_billing_snapshot)) {
          signals.push({
            category: 'invoice_missing_recipient_data',
            severity: CATEGORY_SEVERITY.invoice_missing_recipient_data,
            sourceId: inv.id,
            displayNumber: inv.invoice_number,
            amountCents: inv.total_amount_cents,
            currency: inv.currency,
          });
        }
      }
      continue;
    }
    // paid / void / uncollectible → no attention
  }

  // ─── Received invoices ────────────────────────────────────────────────────
  for (const inv of input.receivedInvoices ?? []) {
    // Recipients only see signals for non-terminal billable states (sent/overdue).
    if (inv.status === 'sent') {
      if (isOverdue(inv.due_date, today)) {
        signals.push({
          category: 'invoice_received_overdue',
          severity: CATEGORY_SEVERITY.invoice_received_overdue,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
          date: inv.due_date,
        });
      } else {
        signals.push({
          category: 'invoice_received_unpaid',
          severity: CATEGORY_SEVERITY.invoice_received_unpaid,
          sourceId: inv.id,
          displayNumber: inv.invoice_number,
          amountCents: inv.total_amount_cents,
          currency: inv.currency,
          date: inv.due_date,
        });
      }
    } else if (inv.status === 'overdue') {
      signals.push({
        category: 'invoice_received_overdue',
        severity: CATEGORY_SEVERITY.invoice_received_overdue,
        sourceId: inv.id,
        displayNumber: inv.invoice_number,
        amountCents: inv.total_amount_cents,
        currency: inv.currency,
        date: inv.due_date,
      });
    }
  }

  // ─── Settlements (agency-internal only) ───────────────────────────────────
  for (const s of input.settlements ?? []) {
    if (s.status === 'draft' && (s.net_amount_cents ?? 0) > 0) {
      signals.push({
        category: 'settlement_draft_pending',
        severity: CATEGORY_SEVERITY.settlement_draft_pending,
        sourceId: s.id,
        displayNumber: s.settlement_number,
        amountCents: s.net_amount_cents,
        currency: s.currency,
      });
    } else if (s.status === 'recorded') {
      signals.push({
        category: 'settlement_recorded_unpaid',
        severity: CATEGORY_SEVERITY.settlement_recorded_unpaid,
        sourceId: s.id,
        displayNumber: s.settlement_number,
        amountCents: s.net_amount_cents,
        currency: s.currency,
      });
    }
  }

  // ─── Org-level: missing billing profile ──────────────────────────────────
  if (input.hasBillingProfile === false) {
    signals.push({
      category: 'billing_profile_missing',
      severity: CATEGORY_SEVERITY.billing_profile_missing,
      sourceId: 'org:billing_profile_missing',
    });
  }

  // Sort: critical → high → medium → low; preserve insertion order otherwise.
  signals.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return signals;
}

/**
 * Roles allowed to see a given category. Used to gate the Billing tab badge per role.
 *
 * - Issuer-side categories visible to BOTH agency_owner and agency_member (booker)
 *   for transparency, but only owner can act (UI gates writes via canEditBilling()).
 * - Received-side categories visible to client_owner and client_member.
 * - Settlement / billing_profile_missing: agency-only.
 */
export function billingCategoryRoles(category: BillingAttentionCategory): BillingAttentionRole[] {
  switch (category) {
    case 'invoice_overdue':
    case 'invoice_unpaid':
    case 'invoice_draft_pending':
    case 'invoice_pending_send':
      return ['agency_owner', 'agency_member', 'client_owner', 'client_member'];
    // 20261123 — Issuer-only operational alerts. Recipients learn about
    // payment failures via Stripe's own email; they don't need to see drafts
    // that are still missing recipient data. Showing these to the recipient
    // would leak issuer-side workflow noise.
    case 'invoice_payment_failed':
    case 'invoice_missing_recipient_data':
      return ['agency_owner', 'agency_member'];
    case 'invoice_received_overdue':
    case 'invoice_received_unpaid':
      return ['agency_owner', 'agency_member', 'client_owner', 'client_member'];
    case 'settlement_draft_pending':
    case 'settlement_recorded_unpaid':
      return ['agency_owner', 'agency_member'];
    case 'billing_profile_missing':
      return ['agency_owner', 'agency_member', 'client_owner', 'client_member'];
  }
}

/**
 * Filter signals to those visible for the given role. Returns the filtered
 * array sorted by severity (critical first).
 */
export function filterBillingAttentionForRole(
  signals: BillingAttentionSignal[],
  role: BillingAttentionRole,
): BillingAttentionSignal[] {
  return signals.filter((s) => billingCategoryRoles(s.category).includes(role));
}

/**
 * True if any signal at the given role triggers a Billing tab badge.
 * The dot is shown for any visible signal of any severity (mirrors Messages tab dot).
 */
export function billingTabBadgeForRole(
  signals: BillingAttentionSignal[],
  role: BillingAttentionRole,
): boolean {
  return filterBillingAttentionForRole(signals, role).length > 0;
}

/**
 * Highest severity present (for color coding header banners).
 * Returns null when no signals visible to the role.
 */
export function highestBillingSeverityForRole(
  signals: BillingAttentionSignal[],
  role: BillingAttentionRole,
): BillingAttentionSeverity | null {
  const visible = filterBillingAttentionForRole(signals, role);
  if (visible.length === 0) return null;
  let best: BillingAttentionSeverity = 'low';
  for (const s of visible) {
    if (SEVERITY_RANK[s.severity] > SEVERITY_RANK[best]) best = s.severity;
  }
  return best;
}
