jest.mock('../../services/subscriptionSupabase', () => ({
  PLAN_LIMITS: {
    trial: { swipesPerDay: 10, storageGB: 10, maxAgencyMembers: 2 },
    agency_basic: { swipesPerDay: 10, storageGB: 10, maxAgencyMembers: 2 },
    agency_pro: { swipesPerDay: 20, storageGB: 100, maxAgencyMembers: 6 },
    agency_enterprise: { swipesPerDay: 40, storageGB: 200, maxAgencyMembers: 20 },
    client: { swipesPerDay: null, storageGB: null, maxAgencyMembers: null },
    admin: { swipesPerDay: null, storageGB: null, maxAgencyMembers: null },
  },
}));

import { planDisplayName, planFeatureLines } from '../planFeatures';
import { uiCopy } from '../uiCopy';

describe('planDisplayName', () => {
  it('maps known plans to uiCopy labels', () => {
    expect(planDisplayName('agency_pro')).toBe(uiCopy.billing.planNameAgencyPro);
    expect(planDisplayName('client')).toBe(uiCopy.billing.planNameClient);
    expect(planDisplayName(null)).toBe(uiCopy.billing.planNameTrial);
  });
});

describe('planFeatureLines', () => {
  it('returns trial-style limits for trial context', () => {
    const lines = planFeatureLines(null, true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('swipe'))).toBe(true);
  });

  it('returns agency_pro feature set when not trial', () => {
    const lines = planFeatureLines('agency_pro', false);
    expect(lines.some((l) => l.includes('100'))).toBe(true);
  });
});
