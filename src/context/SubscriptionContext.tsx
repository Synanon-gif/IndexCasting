/**
 * SubscriptionContext
 *
 * Provides platform access state to the entire app tree.
 * Loads access status on mount and re-loads whenever auth state changes.
 *
 * Security note: this context is UI-only. It mirrors the state returned by
 * can_access_platform() for rendering purposes. All real enforcement happens
 * server-side in SECURITY DEFINER RPCs.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  getMyOrgAccessStatus,
  getTrialDaysLeft,
  type OrgAccessStatus,
  type PlanType,
} from '../services/subscriptionSupabase';

// MED-01: Re-check subscription every 5 minutes while app is in foreground.
// Prevents a user with an expired trial/subscription from continuing to use
// the app in the same session without the paywall gate appearing.
const SUBSCRIPTION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionState {
  /** True when access status has been fetched at least once. */
  loaded: boolean;
  /** True while re-fetching in the background. */
  refreshing: boolean;
  /** The raw response from can_access_platform(). */
  accessStatus: OrgAccessStatus | null;
  /** Shorthand: accessStatus.allowed === false. */
  isBlocked: boolean;
  /** Shorthand: accessStatus.reason === 'admin_override'. */
  isAdminOverride: boolean;
  /** The active plan name; null during trial with no plan set. */
  currentPlan: PlanType | null;
  /** Days remaining in trial; 0 when expired or no trial. */
  trialDaysLeft: number;
  /**
   * Organization type resolved server-side — cannot be spoofed.
   * null while loading or when user has no org.
   */
  orgType: 'agency' | 'client' | null;
  /** Shorthand: orgType === 'client'. */
  isClientOrg: boolean;
  /** Re-fetch access status (e.g. after checkout completes). */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accessStatus, setAccessStatus] = useState<OrgAccessStatus | null>(null);

  const loadingRef = useRef(false);

  const fetchAccessStatus = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const status = await getMyOrgAccessStatus();
      setAccessStatus(status);
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void fetchAccessStatus();
  }, [fetchAccessStatus]);

  // Re-fetch on auth state change (sign-in, sign-out, token refresh)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void fetchAccessStatus();
      }
      if (event === 'SIGNED_OUT') {
        setAccessStatus(null);
        setLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchAccessStatus]);

  // MED-01: Re-fetch when app comes back to foreground (e.g. user switches apps
  // and returns after subscription expires or trial ends).
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void fetchAccessStatus();
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [fetchAccessStatus]);

  // MED-01: Periodic refresh every 5 minutes while app is foregrounded.
  // Ensures subscription state stays current during long sessions.
  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void fetchAccessStatus();
      }
    }, SUBSCRIPTION_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAccessStatus]);

  const value = useMemo<SubscriptionState>(() => {
    const isBlocked       = loaded && (accessStatus === null || !accessStatus.allowed);
    const isAdminOverride = accessStatus?.reason === 'admin_override';
    const currentPlan     = accessStatus?.plan ?? null;
    const trialDaysLeft   = getTrialDaysLeft(accessStatus?.trial_ends_at ?? null);
    const orgType         = accessStatus?.org_type ?? null;
    const isClientOrg     = orgType === 'client';

    return {
      loaded,
      refreshing,
      accessStatus,
      isBlocked,
      isAdminOverride,
      currentPlan,
      trialDaysLeft,
      orgType,
      isClientOrg,
      refresh: fetchAccessStatus,
    };
  }, [loaded, refreshing, accessStatus, fetchAccessStatus]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used inside <SubscriptionProvider>');
  }
  return ctx;
}
