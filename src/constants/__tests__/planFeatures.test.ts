jest.mock('../../services/subscriptionSupabase', () => ({
  PLAN_LIMITS: {
    trial:             { swipesPerDay: 10, storageGB: 5, maxAgencyMembers: 2 },
    agency_basic:      { swipesPerDay: 10, storageGB: 5, maxAgencyMembers: 2 },
    agency_pro:        { swipesPerDay: 50, storageGB: 50, maxAgencyMembers: 4 },
    agency_enterprise: { swipesPerDay: 150, storageGB: 500, maxAgencyMembers: null },
    client:            { swipesPerDay: null, storageGB: null, maxAgencyMembers: null },
    admin:             { swipesPerDay: null, storageGB: null, maxAgencyMembers: null },
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
    expect(lines.some((l) => l.includes('50'))).toBe(true);
  });
});
