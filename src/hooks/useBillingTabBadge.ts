/**
 * useBillingTabBadge — Smart Attention badge for the Billing bottom tab.
 *
 * Mirrors the design of the Messages tab dot: returns true when there is at least
 * one billing attention signal visible to the current role (issuer or recipient).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MODES (Phase C.2 — 20261124)
 * ──────────────────────────────────────────────────────────────────────────────
 *  - `mode: 'detailed'` (default, backwards-compat):
 *      Loads issued invoices, received invoices, settlements, profile presence
 *      and runs `deriveBillingAttention` on the full denormalized snapshot.
 *      Returns full `signals[]` so the Billing widget / banner can render
 *      per-row context. Heavier — appropriate for the Billing screen itself.
 *
 *  - `mode: 'counts'`:
 *      Calls the SECURITY DEFINER RPC `get_billing_attention_counts(org_id)`
 *      which returns ONLY counts per category. Constructs synthetic signals
 *      (one per category with count > 0) so existing helpers
 *      (`billingTabBadgeForRole`, `highestBillingSeverityForRole`) keep
 *      working unchanged. O(11) payload regardless of org size — appropriate
 *      for the bottom-nav badge that mounts on every screen.
 *
 * Role-based visibility filtering (`billingCategoryRoles`) is applied inside
 * the helpers, so both modes return the same `hasBadge` / `topSeverity`
 * values for a given role + dataset.
 *
 * All loads are best-effort — failures degrade to "no badge" rather than
 * throwing. Hook is polled lazily (initial load + manual refresh callback)
 * so it never tight-loops; callers attach to navigation events to refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BillingAttentionCategory,
  type BillingAttentionRole,
  type BillingAttentionSeverity,
  type BillingAttentionSignal,
  billingTabBadgeForRole,
  deriveBillingAttention,
  highestBillingSeverityForRole,
} from '../utils/billingAttention';
import {
  listInvoicesForOrganization,
  listInvoicesForRecipient,
} from '../services/invoicesSupabase';
import { listAgencyModelSettlements } from '../services/agencyModelSettlementsSupabase';
import { listOrganizationBillingProfiles } from '../services/billingProfilesSupabase';
import {
  getBillingAttentionCounts,
  type BillingAttentionCountsByCategory,
} from '../services/billingAttentionCountsSupabase';

export type UseBillingTabBadgeMode = 'counts' | 'detailed';

export type UseBillingTabBadgeArgs = {
  organizationId: string | null | undefined;
  variant: 'agency' | 'client';
  role: BillingAttentionRole;
  /** When false, the hook short-circuits and returns no badge (e.g. tab hidden). */
  enabled?: boolean;
  /**
   * Loading mode. Default `'detailed'` for backwards compatibility with the
   * Billing widget which needs full per-signal context. Bottom-tab badges
   * should pass `'counts'` to use the lightweight RPC path.
   */
  mode?: UseBillingTabBadgeMode;
};

export type UseBillingTabBadgeResult = {
  hasBadge: boolean;
  signals: BillingAttentionSignal[];
  topSeverity: BillingAttentionSeverity | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

// Severity tier per category — must mirror CATEGORY_SEVERITY in
// src/utils/billingAttention.ts. Used only by the counts-mode synthesizer
// so existing helpers can reduce to top severity without further config.
const SYNTHESIZED_SEVERITY: Record<BillingAttentionCategory, BillingAttentionSeverity> = {
  invoice_overdue: 'critical',
  invoice_unpaid: 'high',
  invoice_draft_pending: 'medium',
  invoice_pending_send: 'critical',
  invoice_payment_failed: 'critical',
  invoice_missing_recipient_data: 'high',
  invoice_received_unpaid: 'high',
  invoice_received_overdue: 'critical',
  settlement_draft_pending: 'low',
  settlement_recorded_unpaid: 'medium',
  billing_profile_missing: 'high',
};

function synthesizeSignalsFromCounts(
  counts: BillingAttentionCountsByCategory,
): BillingAttentionSignal[] {
  const out: BillingAttentionSignal[] = [];
  for (const cat of Object.keys(counts) as BillingAttentionCategory[]) {
    const n = counts[cat];
    if (n > 0) {
      // Only synthesize ONE signal per non-empty category — that is sufficient
      // for `billingTabBadgeForRole` (boolean) and `highestBillingSeverityForRole`
      // (max). Avoids inflating the in-memory list pointlessly.
      // Counts mode does not load row data, so display fields stay undefined.
      out.push({
        category: cat,
        severity: SYNTHESIZED_SEVERITY[cat],
        sourceId: `counts:${cat}`,
      });
    }
  }
  return out;
}

export function useBillingTabBadge({
  organizationId,
  variant,
  role,
  enabled = true,
  mode = 'detailed',
}: UseBillingTabBadgeArgs): UseBillingTabBadgeResult {
  const [signals, setSignals] = useState<BillingAttentionSignal[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !organizationId) {
      setSignals([]);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'counts') {
        // Lightweight path — single RPC call, O(11) payload.
        const counts = await getBillingAttentionCounts(organizationId);
        setSignals(counts ? synthesizeSignalsFromCounts(counts) : []);
      } else {
        // Detailed path — full snapshot for the Billing widget / banner.
        const [issued, received, settlements, profiles] = await Promise.all([
          variant === 'agency'
            ? listInvoicesForOrganization(organizationId)
            : Promise.resolve([] as Awaited<ReturnType<typeof listInvoicesForOrganization>>),
          listInvoicesForRecipient(organizationId),
          variant === 'agency'
            ? listAgencyModelSettlements(organizationId)
            : Promise.resolve([] as Awaited<ReturnType<typeof listAgencyModelSettlements>>),
          listOrganizationBillingProfiles(organizationId),
        ]);
        const next = deriveBillingAttention({
          issuedInvoices: issued ?? [],
          receivedInvoices: received ?? [],
          settlements: settlements ?? [],
          hasBillingProfile: (profiles ?? []).length > 0,
        });
        setSignals(next);
      }
    } catch (e) {
      console.error('[useBillingTabBadge] load failed:', e);
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, mode, organizationId, variant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasBadge = useMemo(() => billingTabBadgeForRole(signals, role), [signals, role]);
  const topSeverity = useMemo(() => highestBillingSeverityForRole(signals, role), [signals, role]);

  return { hasBadge, signals, topSeverity, loading, refresh };
}
