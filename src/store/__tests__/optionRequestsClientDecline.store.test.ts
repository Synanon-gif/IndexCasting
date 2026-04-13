/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Store-level tests: clientRejectCounterStore
 *
 * Covers:
 *  - Success path: service returns true → store returns true, cache updated
 *  - Failure path: service returns false → store returns false, cache unchanged
 *  - Inflight guard: second call while first is in-flight → returns false immediately
 */

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockChain = () => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  or: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lt: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
  then: jest.fn(),
});

let currentFromResult: any = null;
const mockFromFn = jest.fn(() => {
  const chain = mockChain();
  if (currentFromResult) {
    const result = currentFromResult;
    currentFromResult = null;
    Object.defineProperty(chain, 'then', {
      value: (resolve: any) => resolve(result),
    });
    chain.limit = jest.fn().mockReturnValue({
      ...chain,
      then: (resolve: any) => resolve(result),
    });
    chain.order = jest.fn().mockReturnValue({
      ...chain,
      limit: jest.fn().mockReturnValue({
        ...chain,
        or: jest.fn().mockReturnValue({
          ...chain,
          lt: jest.fn().mockReturnValue({
            then: (resolve: any) => resolve(result),
          }),
          then: (resolve: any) => resolve(result),
        }),
        lt: jest.fn().mockReturnValue({
          then: (resolve: any) => resolve(result),
        }),
        then: (resolve: any) => resolve(result),
      }),
    });
  }
  return chain;
});

const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: mockFromFn,
    rpc: mockRpc,
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-c1' } } }) },
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: jest.fn(),
  },
}));

// ─── Service mock: control clientRejectCounterOfferOnSupabase per test ────────

let mockRejectServiceResult: boolean = true;
// Defined before the jest.mock call so it can be referenced in the factory.
const rejectServiceFn = jest.fn<Promise<boolean>, [string]>(
  async (_id: string) => mockRejectServiceResult,
);

jest.mock('../../services/optionRequestsSupabase', () => {
  const actual = jest.requireActual<
    typeof import('../../services/optionRequestsSupabase')
  >('../../services/optionRequestsSupabase');
  return {
    ...actual,
    clientRejectCounterOfferOnSupabase: (id: string) => rejectServiceFn(id),
  };
});

jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('../../services/pushNotifications', () => ({
  registerPushNotifications: jest.fn(),
  deregisterPushNotifications: jest.fn(),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import {
  loadOptionRequestsForClient,
  clientRejectCounterStore,
  getOptionRequests,
} from '../optionRequests';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date().toISOString();

function makeRow(
  id: string,
  overrides: Partial<SupabaseOptionRequest> = {},
): SupabaseOptionRequest {
  return {
    id,
    client_id: 'c1',
    model_id: 'm1',
    agency_id: 'a1',
    requested_date: '2026-07-01',
    status: 'in_negotiation',
    project_id: null,
    client_name: null,
    model_name: null,
    job_description: null,
    proposed_price: 1000,
    agency_counter_price: 900,
    client_price_status: 'pending',
    final_status: 'option_confirmed',
    request_type: 'option',
    currency: 'EUR',
    start_time: null,
    end_time: null,
    model_approval: 'approved',
    model_approved_at: null,
    model_account_linked: true,
    booker_id: null,
    organization_id: 'org1',
    agency_organization_id: 'org-a1',
    client_organization_id: 'org-c1',
    client_organization_name: 'Fashion Corp',
    agency_organization_name: 'Agency Inc',
    created_by: null,
    agency_assignee_user_id: null,
    is_agency_only: false,
    agency_event_group_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('clientRejectCounterStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentFromResult = null;
    mockRejectServiceResult = true;
  });

  it('success: service true → store returns true, cache reflects rejected price status', async () => {
    // Axis 2 already confirmed (option_confirmed) — Axis 1 decline must still work
    const row = makeRow('req-success', { final_status: 'option_confirmed' });
    currentFromResult = { data: [row], error: null };
    mockRejectServiceResult = true;

    await loadOptionRequestsForClient('org-c1');

    const preReq = getOptionRequests().find((r: any) => r.id === 'req-success') as any;
    expect(preReq).toBeDefined();
    expect(preReq.clientPriceStatus).toBe('pending');

    const result = await clientRejectCounterStore(preReq.threadId);

    expect(result).toBe(true);
    expect(rejectServiceFn).toHaveBeenCalledWith('req-success');

    const postReq = getOptionRequests().find((r: any) => r.id === 'req-success') as any;
    expect(postReq).toBeDefined();
    // Store falls back to direct field set when getOptionRequestById returns null
    expect(postReq.clientPriceStatus).toBe('rejected');
  });

  it('failure: service false → store returns false, cache is unchanged', async () => {
    const row = makeRow('req-fail');
    currentFromResult = { data: [row], error: null };
    // Simulate RPC returning false (e.g. already processed or state mismatch)
    mockRejectServiceResult = false;

    await loadOptionRequestsForClient('org-c1');

    const preReq = getOptionRequests().find((r: any) => r.id === 'req-fail') as any;
    expect(preReq).toBeDefined();

    const result = await clientRejectCounterStore(preReq.threadId);

    expect(result).toBe(false);

    // Cache must remain unchanged — buttons stay visible, no false success state
    const postReq = getOptionRequests().find((r: any) => r.id === 'req-fail') as any;
    expect(postReq).toBeDefined();
    expect(postReq.clientPriceStatus).toBe('pending');

    // No system message or notification RPC calls should have been made
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('inflight guard: second call while first is in-flight returns false immediately', async () => {
    const row = makeRow('req-inflight');
    currentFromResult = { data: [row], error: null };

    // First service call is slow — never resolves during test body
    let resolveFirst!: (v: boolean) => void;
    const firstServicePromise = new Promise<boolean>((res) => {
      resolveFirst = res;
    });
    rejectServiceFn.mockImplementationOnce(() => firstServicePromise);

    await loadOptionRequestsForClient('org-c1');

    const preReq = getOptionRequests().find((r: any) => r.id === 'req-inflight') as any;
    expect(preReq).toBeDefined();
    const { threadId } = preReq;

    // Fire first call (not awaited) — holds the inflight lock
    const firstCallPromise = clientRejectCounterStore(threadId);

    // Second call while first is in-flight must be blocked immediately
    const secondResult = await clientRejectCounterStore(threadId);
    expect(secondResult).toBe(false);

    // Service was called exactly once (second call was blocked before reaching service)
    expect(rejectServiceFn).toHaveBeenCalledTimes(1);

    // Resolve the first call and verify it also returns false (service returned false)
    resolveFirst(false);
    const firstResult = await firstCallPromise;
    expect(firstResult).toBe(false);
  });
});
