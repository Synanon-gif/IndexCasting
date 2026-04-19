/**
 * useBillingTabBadge — Smart Attention badge boolean for the Billing bottom tab.
 *
 * Mirrors the design of the Messages tab dot: returns true when there is at least
 * one billing attention signal visible to the current role (issuer or recipient).
 *
 * Loads:
 *   - issued invoices (agency only)
 *   - received invoices (always)
 *   - agency model settlements (agency only)
 *   - org billing profiles (presence flag)
 *
 * All loads are best-effort — failures degrade to "no badge" rather than throwing.
 * Hook is deliberately polled lazily (initial load + manual refresh callback) so
 * it never tight-loops; callers can attach to navigation events to refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type BillingAttentionRole,
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

export type UseBillingTabBadgeArgs = {
  organizationId: string | null | undefined;
  variant: 'agency' | 'client';
  role: BillingAttentionRole;
  /** When false, the hook short-circuits and returns no badge (e.g. tab hidden). */
  enabled?: boolean;
};

export type UseBillingTabBadgeResult = {
  hasBadge: boolean;
  signals: BillingAttentionSignal[];
  topSeverity: ReturnType<typeof highestBillingSeverityForRole>;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useBillingTabBadge({
  organizationId,
  variant,
  role,
  enabled = true,
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
    } catch (e) {
      console.error('[useBillingTabBadge] load failed:', e);
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, organizationId, variant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasBadge = useMemo(() => billingTabBadgeForRole(signals, role), [signals, role]);
  const topSeverity = useMemo(() => highestBillingSeverityForRole(signals, role), [signals, role]);

  return { hasBadge, signals, topSeverity, loading, refresh };
}
