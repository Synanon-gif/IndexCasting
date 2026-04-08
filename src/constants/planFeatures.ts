/**
 * UI-only plan labels and feature bullets — aligned with Paywall plan cards and PLAN_LIMITS.
 * Not a second source of entitlement truth; server RPCs enforce limits.
 */
import { uiCopy } from './uiCopy';
import type { PlanType } from '../services/subscriptionSupabase';
import { PLAN_LIMITS } from '../services/subscriptionSupabase';

const b = uiCopy.billing;

export function planDisplayName(plan: PlanType | null): string {
  switch (plan) {
    case 'agency_basic':
      return b.planNameAgencyBasic;
    case 'agency_pro':
      return b.planNameAgencyPro;
    case 'agency_enterprise':
      return b.planNameAgencyEnterprise;
    case 'client':
      return b.planNameClient;
    case 'trial':
      return b.planNameTrial;
    case 'admin':
      return b.planNameAdmin;
    default:
      return b.planNameTrial;
  }
}

/** Feature bullets for marketing-style display — mirrors PaywallScreen ALL_PLAN_CARDS. */
export function planFeatureLines(plan: PlanType | null, isTrialContext: boolean): string[] {
  if (isTrialContext || plan === 'trial' || plan === null) {
    const L = PLAN_LIMITS.trial;
    const sw = L.swipesPerDay ?? 10;
    const gb = L.storageGB ?? 5;
    return [
      b.swipesPerDay(sw),
      b.storageLimit(gb),
      b.realtimeMessaging,
      b.castingManagement,
    ];
  }

  switch (plan) {
    case 'agency_basic':
      return [
        b.swipesPerDay(10),
        b.storageLimit(5),
        b.realtimeMessaging,
        b.castingManagement,
      ];
    case 'agency_pro':
      return [
        b.swipesPerDay(50),
        b.storageLimit(50),
        b.realtimeMessaging,
        b.castingManagement,
        b.fullPlatformAccess,
      ];
    case 'agency_enterprise':
      return [
        b.swipesPerDay(150),
        b.storageLimit(500),
        b.realtimeMessaging,
        b.castingManagement,
        b.fullPlatformAccess,
      ];
    case 'client':
      return [
        b.swipesUnlimited,
        b.storageUnlimited,
        b.realtimeMessaging,
        b.castingManagement,
        b.fullPlatformAccess,
      ];
    case 'admin':
      return [b.swipesUnlimited, b.storageUnlimited, b.fullPlatformAccess];
    default:
      return planFeatureLines(null, true);
  }
}
