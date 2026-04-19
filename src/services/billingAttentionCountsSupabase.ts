/**
 * Counts-only Billing Smart Attention RPC wrapper.
 *
 * Phase C.2 — paired with `useBillingTabBadge({ mode: 'counts' })`.
 *
 * Returns a record of counts per BillingAttentionCategory for the calling
 * organization. The DB does the aggregation server-side so that the
 * bottom-tab Billing badge does NOT need to load every invoice/settlement
 * just to compute one boolean (which is a real performance cost for large
 * agencies with thousands of invoices).
 *
 * Pure data wrapper — Option A contract: returns null on any error so
 * callers can fall back to "no badge" without throwing.
 */
import { supabase } from '../../lib/supabase';
import type { BillingAttentionCategory } from '../utils/billingAttention';

export type BillingAttentionCountsByCategory = Record<BillingAttentionCategory, number>;

const ALL_CATEGORIES: BillingAttentionCategory[] = [
  'invoice_overdue',
  'invoice_unpaid',
  'invoice_draft_pending',
  'invoice_pending_send',
  'invoice_payment_failed',
  'invoice_missing_recipient_data',
  'invoice_received_unpaid',
  'invoice_received_overdue',
  'settlement_draft_pending',
  'settlement_recorded_unpaid',
  'billing_profile_missing',
];

/**
 * Fetch billing attention counts for an organization.
 *
 * @param organizationId Organization to fetch counts for. Caller MUST be a
 *   member of this org or the RPC will throw `not_org_member`.
 * @param opts.today Optional ISO date for overdue calculation (test seam).
 * @param opts.pendingSendStuckMinutes Optional override (default 30).
 * @returns Counts map (every category present, 0 when none) or null on error.
 */
export async function getBillingAttentionCounts(
  organizationId: string,
  opts?: { today?: string; pendingSendStuckMinutes?: number },
): Promise<BillingAttentionCountsByCategory | null> {
  if (!organizationId) {
    console.error('[getBillingAttentionCounts] missing organizationId');
    return null;
  }
  try {
    const { data, error } = await supabase.rpc('get_billing_attention_counts', {
      p_organization_id: organizationId,
      ...(opts?.today ? { p_today: opts.today } : {}),
      ...(typeof opts?.pendingSendStuckMinutes === 'number'
        ? { p_pending_send_stuck_minutes: opts.pendingSendStuckMinutes }
        : {}),
    });
    if (error) {
      console.error('[getBillingAttentionCounts] rpc error:', error);
      return null;
    }
    const raw = (data as { counts?: Record<string, number> } | null)?.counts ?? {};
    // Defensive normalization: ensure every known category is present so callers
    // can iterate without undefined-checks. Unknown keys (future categories) are
    // ignored so older clients don't crash.
    const counts: BillingAttentionCountsByCategory = ALL_CATEGORIES.reduce((acc, cat) => {
      const v = raw[cat];
      acc[cat] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
      return acc;
    }, {} as BillingAttentionCountsByCategory);
    return counts;
  } catch (e) {
    console.error('[getBillingAttentionCounts] exception:', e);
    return null;
  }
}
