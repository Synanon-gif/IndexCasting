/**
 * Subscription service.
 *
 * All access decisions are enforced server-side via SECURITY DEFINER RPCs.
 * The frontend uses this module to read access state and open Stripe Checkout.
 *
 * NEVER trust the results of these calls to gate server-side actions —
 * the DB RPCs (can_access_platform, increment_my_agency_swipe_count, etc.)
 * are the real enforcement layer.  This module only powers the UI.
 */

import { supabase } from '../../lib/supabase';
import { supabaseUrl } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanType =
  | 'agency_basic'
  | 'agency_pro'
  | 'agency_enterprise'
  | 'client'
  | 'trial'
  | 'admin';

export type AccessReason =
  | 'admin_override'
  | 'trial_active'
  | 'subscription_active'
  | 'no_active_subscription'
  | 'no_org';

export interface OrgAccessStatus {
  allowed: boolean;
  reason: AccessReason;
  plan: PlanType | null;
  trial_ends_at: string | null;
  organization_id: string | null;
  /** Resolved server-side from organizations.type — cannot be spoofed by frontend. */
  org_type: 'agency' | 'client' | null;
}

export interface OrgSubscription {
  organization_id: string;
  // stripe_customer_id and stripe_subscription_id are intentionally omitted:
  // exposing raw Stripe IDs to all org members (incl. non-owners) creates a
  // social-engineering vector. Use server-side RPCs for billing operations. (VULN-08 fix)
  plan: PlanType | null;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  trial_ends_at: string;
  created_at: string;
}

export interface AdminOverride {
  organization_id: string;
  bypass_paywall: boolean;
  custom_plan: string | null;
}

export interface PlanLimits {
  swipesPerDay: number | null;   // null = unlimited
  storageGB:    number | null;   // null = unlimited
}

// ─── Plan metadata ────────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  agency_basic:      { swipesPerDay: 10,  storageGB: 5   },
  agency_pro:        { swipesPerDay: 50,  storageGB: 50  },
  agency_enterprise: { swipesPerDay: 150, storageGB: 500 },
  client:            { swipesPerDay: null, storageGB: null },
  trial:             { swipesPerDay: 10,  storageGB: 5   },
  admin:             { swipesPerDay: null, storageGB: null },
};

// ─── Core: getMyOrgAccessStatus ──────────────────────────────────────────────

/**
 * Calls the SECURITY DEFINER RPC `can_access_platform()`.
 * The org_id is resolved inside the DB from auth.uid() — it cannot be spoofed.
 *
 * Use this to render the correct UI state (trial/active/blocked).
 * Do NOT use this as the only gate for server-side actions.
 */
export async function getMyOrgAccessStatus(): Promise<OrgAccessStatus> {
  try {
    const { data, error } = await supabase.rpc('can_access_platform');
    if (error) throw error;

    const raw = data as Record<string, unknown>;
    return {
      allowed:         Boolean(raw.allowed),
      reason:          (raw.reason as AccessReason) ?? 'no_org',
      plan:            (raw.plan as PlanType | null) ?? null,
      trial_ends_at:   raw.trial_ends_at != null ? String(raw.trial_ends_at) : null,
      organization_id: raw.organization_id != null ? String(raw.organization_id) : null,
      org_type:        raw.org_type === 'client' ? 'client' : raw.org_type === 'agency' ? 'agency' : null,
    };
  } catch (err) {
    console.error('[subscription] getMyOrgAccessStatus error:', err);
    // Fail closed: on error we treat as blocked so the user sees the paywall
    // rather than silently gaining access.
    return {
      allowed:         false,
      reason:          'no_org',
      plan:            null,
      trial_ends_at:   null,
      organization_id: null,
      org_type:        null,
    };
  }
}

// ─── getMyOrgSubscription ─────────────────────────────────────────────────────

/**
 * Reads the caller's organization subscription row directly (via RLS SELECT).
 * Returns null when no row exists yet.
 */
export async function getMyOrgSubscription(): Promise<OrgSubscription | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!membership?.organization_id) return null;

    // Exclude stripe_customer_id / stripe_subscription_id: raw Stripe IDs must
    // not be exposed to all org members (social-engineering risk). (VULN-08 fix)
    const { data, error } = await supabase
      .from('organization_subscriptions')
      .select('organization_id, plan, status, current_period_end, trial_ends_at, created_at')
      .eq('organization_id', membership.organization_id)
      .maybeSingle();

    if (error) throw error;
    return (data as OrgSubscription | null);
  } catch (err) {
    console.error('[subscription] getMyOrgSubscription error:', err);
    return null;
  }
}

// ─── getMyAdminOverride ───────────────────────────────────────────────────────

export async function getMyAdminOverride(): Promise<AdminOverride | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!membership?.organization_id) return null;

    const { data, error } = await supabase
      .from('admin_overrides')
      .select('organization_id, bypass_paywall, custom_plan')
      .eq('organization_id', membership.organization_id)
      .maybeSingle();

    if (error) throw error;
    return (data as AdminOverride | null);
  } catch (err) {
    console.error('[subscription] getMyAdminOverride error:', err);
    return null;
  }
}

// ─── createCheckoutSession ────────────────────────────────────────────────────

/**
 * Calls the Edge Function `create-checkout-session`.
 * The Edge Function resolves the org_id from the caller's JWT server-side.
 * Returns the Stripe checkout URL or null on error.
 */
export async function createCheckoutSession(
  plan: PlanType,
  options?: { success_url?: string; cancel_url?: string },
): Promise<{ checkout_url: string } | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.error('[subscription] createCheckoutSession: no active session');
      return null;
    }

    const fnUrl = `${supabaseUrl}/functions/v1/create-checkout-session`;
    const response = await fetch(fnUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        plan,
        success_url: options?.success_url,
        cancel_url:  options?.cancel_url,
      }),
    });

    const json = await response.json() as { ok: boolean; checkout_url?: string; error?: string };
    if (!json.ok || !json.checkout_url) {
      console.error('[subscription] createCheckoutSession failed:', json.error);
      return null;
    }

    return { checkout_url: json.checkout_url };
  } catch (err) {
    console.error('[subscription] createCheckoutSession error:', err);
    return null;
  }
}

// ─── Computed helpers ─────────────────────────────────────────────────────────

/** Returns the number of full days remaining in the trial, or 0 if expired. */
export function getTrialDaysLeft(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Effective plan limits — admin override with custom_plan takes precedence. */
export function getEffectivePlanLimits(
  plan: PlanType | null,
  isAdminOverride: boolean,
): PlanLimits {
  if (isAdminOverride) return { swipesPerDay: null, storageGB: null };
  if (!plan) return PLAN_LIMITS['trial'];
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['trial'];
}
