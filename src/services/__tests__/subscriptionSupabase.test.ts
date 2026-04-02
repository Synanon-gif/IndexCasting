/**
 * Tests for subscriptionSupabase.ts and billing-related adminSupabase functions.
 *
 * All Supabase calls are mocked. Tests verify:
 *
 * 1.  Trial active       → getMyOrgAccessStatus returns allowed:true, reason:'trial_active'
 * 2.  Trial expired      → getMyOrgAccessStatus returns allowed:false
 * 3.  Admin override     → getMyOrgAccessStatus returns allowed:true, reason:'admin_override'
 *                          regardless of trial/subscription state
 * 4.  Subscription active → allowed:true, reason:'subscription_active'
 * 5.  Non-admin bypass   → adminSetBypassPaywall cannot succeed without is_admin (RPC throws)
 * 6.  Fail-closed on error → getMyOrgAccessStatus returns allowed:false on RPC failure
 * 7.  getTrialDaysLeft   → computes remaining days correctly
 * 8.  getEffectivePlanLimits → admin override returns unlimited; plans return correct values
 * 9.  adminSetBypassPaywall  → calls correct RPC with correct args, returns true
 * 10. adminSetOrgPlan       → calls admin_set_org_plan RPC
 * 11. org_type mapping   → 'client' is correctly mapped from RPC response
 * 12. org_type mapping   → 'agency' is correctly mapped from RPC response
 */

import {
  getMyOrgAccessStatus,
  getTrialDaysLeft,
  getEffectivePlanLimits,
  PLAN_LIMITS,
} from '../subscriptionSupabase';
import { adminSetBypassPaywall, adminSetOrgPlan } from '../adminSupabase';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const rpcMock      = jest.fn();
const insertMock   = jest.fn().mockResolvedValue({ error: null });
const selectMock   = jest.fn();
const fromMock     = jest.fn();

// Supabase mock — used by both subscriptionSupabase and adminSupabase
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc:  (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: {
      getUser:    jest.fn().mockResolvedValue({ data: { user: { id: 'user-id-123' } } }),
      getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

// subscriptionSupabase also imports supabaseUrl from config/env
jest.mock('../../config/env', () => ({
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'anon-key-test',
  supabasePublishableKey: '',
}));

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: supabase.from().select().eq().limit().maybeSingle() chain
  selectMock.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: { organization_id: ORG_ID },
          error: null,
        }),
      }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });
  fromMock.mockReturnValue({ select: selectMock, insert: insertMock });
});

// ─── 1. Trial active ──────────────────────────────────────────────────────────

describe('getMyOrgAccessStatus — trial active', () => {
  it('returns allowed:true with reason trial_active when trial has not expired', async () => {
    const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'trial_active',
        plan:            'trial',
        trial_ends_at:   futureDate,
        organization_id: ORG_ID,
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(rpcMock).toHaveBeenCalledWith('can_access_platform');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('trial_active');
    expect(result.trial_ends_at).toBe(futureDate);
  });
});

// ─── 2. Trial expired / no subscription ──────────────────────────────────────

describe('getMyOrgAccessStatus — trial expired, no subscription', () => {
  it('returns allowed:false with reason no_active_subscription', async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         false,
        reason:          'no_active_subscription',
        plan:            null,
        trial_ends_at:   null,
        organization_id: ORG_ID,
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_active_subscription');
    expect(result.plan).toBeNull();
  });
});

// ─── 3. Admin override (bypass_paywall = true) ────────────────────────────────

describe('getMyOrgAccessStatus — admin override', () => {
  it('returns allowed:true with reason admin_override regardless of subscription state', async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'admin_override',
        plan:            'agency_pro',
        trial_ends_at:   null,
        organization_id: ORG_ID,
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('admin_override');
    // Plan can be custom or 'admin' — should be present
    expect(result.plan).not.toBeNull();
  });
});

// ─── 4. Active subscription ───────────────────────────────────────────────────

describe('getMyOrgAccessStatus — subscription active', () => {
  it('returns allowed:true with reason subscription_active and plan name', async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'subscription_active',
        plan:            'agency_pro',
        trial_ends_at:   null,
        organization_id: ORG_ID,
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('subscription_active');
    expect(result.plan).toBe('agency_pro');
  });
});

// ─── 5. Fail-closed on RPC error ─────────────────────────────────────────────

describe('getMyOrgAccessStatus — RPC failure', () => {
  it('returns allowed:false when can_access_platform RPC throws (fail-closed)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('db connection refused') });

    const result = await getMyOrgAccessStatus();

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_org');
  });

  it('returns allowed:false when RPC rejects entirely', async () => {
    rpcMock.mockRejectedValue(new Error('network timeout'));

    const result = await getMyOrgAccessStatus();

    expect(result.allowed).toBe(false);
  });
});

// ─── 6. Non-admin cannot set bypass_paywall ───────────────────────────────────

describe('adminSetBypassPaywall — non-admin attempt', () => {
  it('returns false when the RPC raises an unauthorized exception', async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: 'admin_set_bypass_paywall: unauthorized' },
    });

    const result = await adminSetBypassPaywall(ORG_ID, true);

    expect(rpcMock).toHaveBeenCalledWith('admin_set_bypass_paywall', {
      p_org_id:      ORG_ID,
      p_bypass:      true,
      p_custom_plan: null,
    });
    // Must return false — the caller should surface an error, not silently succeed.
    expect(result).toBe(false);
  });

  it('returns false when RPC rejects entirely (network / permissions)', async () => {
    rpcMock.mockRejectedValue(new Error('permission denied'));

    const result = await adminSetBypassPaywall(ORG_ID, true);

    expect(result).toBe(false);
  });
});

// ─── 7. adminSetBypassPaywall — success ──────────────────────────────────────

describe('adminSetBypassPaywall — success', () => {
  it('calls admin_set_bypass_paywall with correct args and returns true', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminSetBypassPaywall(ORG_ID, true, 'agency_enterprise');

    expect(rpcMock).toHaveBeenCalledWith('admin_set_bypass_paywall', {
      p_org_id:      ORG_ID,
      p_bypass:      true,
      p_custom_plan: 'agency_enterprise',
    });
    expect(result).toBe(true);
  });

  it('disables override with bypass=false and no custom plan', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminSetBypassPaywall(ORG_ID, false);

    expect(rpcMock).toHaveBeenCalledWith('admin_set_bypass_paywall', {
      p_org_id:      ORG_ID,
      p_bypass:      false,
      p_custom_plan: null,
    });
    expect(result).toBe(true);
  });
});

// ─── 8. adminSetOrgPlan ───────────────────────────────────────────────────────

describe('adminSetOrgPlan', () => {
  it('calls admin_set_org_plan RPC with org_id, plan, and status', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminSetOrgPlan(ORG_ID, 'agency_pro', 'active');

    expect(rpcMock).toHaveBeenCalledWith('admin_set_org_plan', {
      p_org_id: ORG_ID,
      p_plan:   'agency_pro',
      p_status: 'active',
    });
    expect(result).toBe(true);
  });

  it('returns false when RPC returns an error', async () => {
    rpcMock.mockResolvedValue({
      data:  null,
      error: { message: 'admin_set_org_plan: unauthorized' },
    });

    const result = await adminSetOrgPlan(ORG_ID, 'agency_pro');

    expect(result).toBe(false);
  });
});

// ─── 9. getTrialDaysLeft ──────────────────────────────────────────────────────

describe('getTrialDaysLeft', () => {
  it('returns the number of full days remaining when trial is in the future', () => {
    const inTwentyDays = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const days = getTrialDaysLeft(inTwentyDays);
    expect(days).toBeGreaterThanOrEqual(19);
    expect(days).toBeLessThanOrEqual(20);
  });

  it('returns 0 when trial has expired', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(getTrialDaysLeft(yesterday)).toBe(0);
  });

  it('returns 0 when trial_ends_at is null', () => {
    expect(getTrialDaysLeft(null)).toBe(0);
  });
});

// ─── 10. getEffectivePlanLimits ───────────────────────────────────────────────

describe('getEffectivePlanLimits', () => {
  it('returns unlimited for admin override regardless of plan', () => {
    const limits = getEffectivePlanLimits('agency_basic', true);
    expect(limits.swipesPerDay).toBeNull();
    expect(limits.storageGB).toBeNull();
  });

  it('returns correct limits for agency_basic', () => {
    const limits = getEffectivePlanLimits('agency_basic', false);
    expect(limits.swipesPerDay).toBe(PLAN_LIMITS['agency_basic'].swipesPerDay);
    expect(limits.storageGB).toBe(PLAN_LIMITS['agency_basic'].storageGB);
  });

  it('returns correct limits for agency_pro', () => {
    const limits = getEffectivePlanLimits('agency_pro', false);
    expect(limits.swipesPerDay).toBe(50);
    expect(limits.storageGB).toBe(50);
  });

  it('returns correct limits for agency_enterprise', () => {
    const limits = getEffectivePlanLimits('agency_enterprise', false);
    expect(limits.swipesPerDay).toBe(150);
    expect(limits.storageGB).toBe(500);
  });

  it('returns unlimited for client plan', () => {
    const limits = getEffectivePlanLimits('client', false);
    expect(limits.swipesPerDay).toBeNull();
    expect(limits.storageGB).toBeNull();
  });

  it('falls back to trial limits when plan is null', () => {
    const limits = getEffectivePlanLimits(null, false);
    expect(limits).toEqual(PLAN_LIMITS['trial']);
  });
});

// ─── 11. org_type mapping — client ───────────────────────────────────────────

describe('getMyOrgAccessStatus — org_type: client', () => {
  it("maps org_type 'client' correctly from the RPC response", async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'trial_active',
        plan:            'trial',
        trial_ends_at:   new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        organization_id: ORG_ID,
        org_type:        'client',
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.org_type).toBe('client');
    expect(result.allowed).toBe(true);
  });

  it("returns org_type: null (fail-closed) when the RPC response contains an unrecognized org_type", async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'subscription_active',
        plan:            'client',
        trial_ends_at:   null,
        organization_id: ORG_ID,
        org_type:        'unknown_type',  // unexpected value
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.org_type).toBeNull();
  });
});

// ─── 12. org_type mapping — agency ───────────────────────────────────────────

describe('getMyOrgAccessStatus — org_type: agency', () => {
  it("maps org_type 'agency' correctly from the RPC response", async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'subscription_active',
        plan:            'agency_pro',
        trial_ends_at:   null,
        organization_id: ORG_ID,
        org_type:        'agency',
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.org_type).toBe('agency');
    expect(result.allowed).toBe(true);
    expect(result.plan).toBe('agency_pro');
  });

  it("returns org_type: null when org_type is missing from the RPC response (backward compat)", async () => {
    rpcMock.mockResolvedValue({
      data: {
        allowed:         true,
        reason:          'trial_active',
        plan:            'trial',
        trial_ends_at:   new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        organization_id: ORG_ID,
        // org_type omitted — simulates an older DB version
      },
      error: null,
    });

    const result = await getMyOrgAccessStatus();

    expect(result.org_type).toBeNull();
  });
});
