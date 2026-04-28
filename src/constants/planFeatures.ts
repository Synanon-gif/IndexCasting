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
export function planFeatureLines(
  plan: PlanType | null,
  isTrialContext: boolean,
  billingAudience: 'agency' | 'client' = 'agency',
): string[] {
  if (isTrialContext || plan === 'trial' || plan === null) {
    const L = PLAN_LIMITS.trial;
    const sw = L.swipesPerDay ?? 10;
    const gb = L.storageGB ?? 10;
    const seats = L.maxAgencyMembers ?? 2;
    const base: string[] = [b.swipesPerDay(sw), b.storageLimit(gb)];
    if (billingAudience === 'agency') {
      base.push(b.agencyTeamSeats(seats));
    }
    base.push(b.realtimeMessaging, b.castingManagement);
    return base;
  }

  switch (plan) {
    case 'agency_basic':
      return [
        b.swipesPerDay(PLAN_LIMITS.agency_basic.swipesPerDay ?? 10),
        b.storageLimit(PLAN_LIMITS.agency_basic.storageGB ?? 10),
        b.agencyTeamSeats(PLAN_LIMITS.agency_basic.maxAgencyMembers ?? 2),
        b.realtimeMessaging,
        b.castingManagement,
      ];
    case 'agency_pro':
      return [
        b.swipesPerDay(PLAN_LIMITS.agency_pro.swipesPerDay ?? 20),
        b.storageLimit(PLAN_LIMITS.agency_pro.storageGB ?? 100),
        b.agencyTeamSeats(PLAN_LIMITS.agency_pro.maxAgencyMembers ?? 6),
        b.realtimeMessaging,
        b.castingManagement,
        b.fullPlatformAccess,
      ];
    case 'agency_enterprise':
      return [
        b.swipesPerDay(PLAN_LIMITS.agency_enterprise.swipesPerDay ?? 40),
        b.storageLimit(PLAN_LIMITS.agency_enterprise.storageGB ?? 200),
        b.agencyTeamSeats(PLAN_LIMITS.agency_enterprise.maxAgencyMembers ?? 20),
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
      return planFeatureLines(null, true, billingAudience);
  }
}
