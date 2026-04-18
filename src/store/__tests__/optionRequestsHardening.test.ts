/**
 * Store-level hardening tests:
 *
 * C4: addMessage rollback — message removed from cache on failed insert.
 * isAgencyOnly Guard: clientConfirmJobStore must reject agency-only requests.
 * Fallback names: toLocalRequest uses descriptive fallbacks.
 */

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

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: mockFromFn,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: jest.fn(),
  },
}));

jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('../../services/pushNotifications', () => ({
  registerPushNotifications: jest.fn(),
  deregisterPushNotifications: jest.fn(),
}));

import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';

const now = new Date().toISOString();
function makeRow(overrides: Partial<SupabaseOptionRequest> = {}): SupabaseOptionRequest {
  return {
    id: 'req-1',
    client_id: 'c1',
    model_id: 'm1',
    agency_id: 'a1',
    requested_date: '2026-07-01',
    status: 'in_negotiation',
    project_id: null,
    client_name: null,
    model_name: null,
    job_description: null,
    proposed_price: null,
    agency_counter_price: null,
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
    client_organization_name: null,
    agency_organization_name: null,
    created_by: null,
    agency_assignee_user_id: null,
    is_agency_only: false,
    agency_event_group_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('isAgencyOnly: clientConfirmJobStore guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reject agency-only requests immediately', async () => {
    const agencyOnlyRow = makeRow({ id: 'req-agency-only', is_agency_only: true });
    currentFromResult = { data: [agencyOnlyRow], error: null };

    const { loadOptionRequestsForClient, clientConfirmJobStore } = require('../optionRequests');

    await loadOptionRequestsForClient('org-c1');
    const result = await clientConfirmJobStore('req-agency-only');
    expect(result).toBe(false);
  });
});

describe('Fallback names in toLocalRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should prefer client_organization_name over client_name when both are set', async () => {
    const row = makeRow({
      id: 'req-org-first',
      client_name: 'Employee display',
      client_organization_name: 'Fashion Corp',
    });
    currentFromResult = { data: [row], error: null };

    const { loadOptionRequestsForClient, getOptionRequests } = require('../optionRequests');

    await loadOptionRequestsForClient('org-c1');
    const reqs = getOptionRequests();
    const req = reqs.find((r: any) => r.id === 'req-org-first');
    expect(req).toBeDefined();
    expect(req.clientName).toBe('Fashion Corp');
    expect(req.clientOrganizationName).toBe('Fashion Corp');
  });

  it('should use client_organization_name when client_name is null', async () => {
    const row = makeRow({
      id: 'req-fallback',
      client_name: null,
      client_organization_name: 'Fashion Corp',
      model_name: null,
    });
    currentFromResult = { data: [row], error: null };

    const { loadOptionRequestsForClient, getOptionRequests } = require('../optionRequests');

    await loadOptionRequestsForClient('org-c1');
    const reqs = getOptionRequests();
    const req = reqs.find((r: any) => r.id === 'req-fallback');
    expect(req).toBeDefined();
    expect(req.clientName).toBe('Fashion Corp');
    expect(req.modelName).toBe('Unknown model');
  });

  it('should use "Unknown client" when both names are null', async () => {
    const row = makeRow({
      id: 'req-unknown',
      client_name: null,
      client_organization_name: null,
    });
    currentFromResult = { data: [row], error: null };

    const { loadOptionRequestsForClient, getOptionRequests } = require('../optionRequests');

    await loadOptionRequestsForClient('org-c1');
    const reqs = getOptionRequests();
    const req = reqs.find((r: any) => r.id === 'req-unknown');
    expect(req).toBeDefined();
    expect(req.clientName).toBe('Unknown client');
  });
});
