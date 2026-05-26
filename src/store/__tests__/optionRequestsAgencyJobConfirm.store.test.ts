/**
 * Store: agencyConfirmJobAgencyOnlyStore must sync booking_events after job confirm
 * (parity with clientConfirmJobStore → ensureBookingEventSyncedFromOptionRequest).
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

let currentFromResult: { data: unknown; error: null } | null = null;
const mockFromFn = jest.fn(() => {
  const chain = mockChain();
  if (currentFromResult) {
    const result = currentFromResult;
    currentFromResult = null;
    Object.defineProperty(chain, 'then', {
      value: (resolve: (v: unknown) => void) => resolve(result),
    });
    chain.limit = jest.fn().mockReturnValue({
      ...chain,
      then: (resolve: (v: unknown) => void) => resolve(result),
    });
    chain.order = jest.fn().mockReturnValue({
      ...chain,
      limit: jest.fn().mockReturnValue({
        ...chain,
        then: (resolve: (v: unknown) => void) => resolve(result),
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
  notifyClientAgencyCounterOffer: jest.fn(),
}));
jest.mock('../../services/externalCalendarSync', () => ({
  syncOptionRequestConfirmationToExternal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/calendarSupabase', () => ({
  updateCalendarEntryToJob: jest.fn(),
  checkCalendarConflict: jest.fn(),
}));
jest.mock('../../services/optionRequestsSupabase', () => ({
  ...jest.requireActual('../../services/optionRequestsSupabase'),
  getOptionRequestsForAgency: jest.fn(),
  agencyConfirmJobAgencyOnly: jest.fn(),
  getOptionRequestById: jest.fn(),
  ensureBookingEventSyncedFromOptionRequest: jest.fn(),
  addOptionSystemMessage: jest.fn(),
}));

import type { SupabaseOptionRequest } from '../../services/optionRequestsSupabase';
import {
  agencyConfirmJobAgencyOnly,
  ensureBookingEventSyncedFromOptionRequest,
  getOptionRequestById,
  getOptionRequestsForAgency,
  addOptionSystemMessage,
} from '../../services/optionRequestsSupabase';
import { updateCalendarEntryToJob } from '../../services/calendarSupabase';

const agencyConfirmJobAgencyOnlyMock = agencyConfirmJobAgencyOnly as jest.MockedFunction<
  typeof agencyConfirmJobAgencyOnly
>;
const getOptionRequestsForAgencyMock = getOptionRequestsForAgency as jest.MockedFunction<
  typeof getOptionRequestsForAgency
>;
const getOptionRequestByIdMock = getOptionRequestById as jest.MockedFunction<
  typeof getOptionRequestById
>;
const ensureBookingSyncMock = ensureBookingEventSyncedFromOptionRequest as jest.MockedFunction<
  typeof ensureBookingEventSyncedFromOptionRequest
>;
const updateCalendarEntryToJobMock = updateCalendarEntryToJob as jest.MockedFunction<
  typeof updateCalendarEntryToJob
>;
const addOptionSystemMessageMock = addOptionSystemMessage as jest.MockedFunction<
  typeof addOptionSystemMessage
>;

const now = new Date().toISOString();
const REQ_ID = 'req-agency-job-1';

function makeAgencyOnlyRow(overrides: Partial<SupabaseOptionRequest> = {}): SupabaseOptionRequest {
  return {
    id: REQ_ID,
    client_id: 'booker-1',
    model_id: 'model-1',
    agency_id: 'agency-1',
    requested_date: '2026-05-27',
    status: 'confirmed',
    project_id: null,
    client_name: null,
    model_name: 'Test Model',
    job_description: null,
    proposed_price: null,
    agency_counter_price: null,
    client_price_status: null,
    final_status: 'option_confirmed',
    request_type: 'option',
    currency: 'EUR',
    start_time: null,
    end_time: null,
    model_approval: 'approved',
    model_approved_at: now,
    model_account_linked: false,
    booker_id: null,
    organization_id: null,
    agency_organization_id: 'org-agency-1',
    client_organization_id: null,
    client_organization_name: null,
    agency_organization_name: 'Agency Org',
    created_by: null,
    agency_assignee_user_id: null,
    is_agency_only: true,
    agency_event_group_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const {
  loadOptionRequestsForAgency,
  agencyConfirmJobAgencyOnlyStore,
} = require('../optionRequests');

describe('agencyConfirmJobAgencyOnlyStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentFromResult = null;
    agencyConfirmJobAgencyOnlyMock.mockResolvedValue(true);
    updateCalendarEntryToJobMock.mockResolvedValue(true);
    ensureBookingSyncMock.mockResolvedValue(undefined);
    addOptionSystemMessageMock.mockResolvedValue({
      id: 'sys-1',
      option_request_id: REQ_ID,
      from_role: 'system',
      text: 'Agency confirmed the job.',
      message_type: 'system',
      booker_id: null,
      booker_name: null,
      created_at: now,
    });
  });

  it('calls ensureBookingEventSyncedFromOptionRequest after successful agency job confirm', async () => {
    const beforeRow = makeAgencyOnlyRow();
    const afterRow = makeAgencyOnlyRow({
      final_status: 'job_confirmed',
      status: 'confirmed',
    });

    getOptionRequestsForAgencyMock.mockResolvedValue([beforeRow]);
    getOptionRequestByIdMock.mockResolvedValue(afterRow);

    await loadOptionRequestsForAgency('agency-1', 'org-agency-1');
    const ok = await agencyConfirmJobAgencyOnlyStore(REQ_ID);

    expect(ok).toBe(true);
    expect(agencyConfirmJobAgencyOnlyMock).toHaveBeenCalledWith(REQ_ID);
    expect(updateCalendarEntryToJobMock).toHaveBeenCalledWith(REQ_ID);
    expect(ensureBookingSyncMock).toHaveBeenCalledWith(REQ_ID);
    expect(ensureBookingSyncMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      agencyConfirmJobAgencyOnlyMock.mock.invocationCallOrder[0]!,
    );
  });

  it('does not sync booking_events when agency job confirm RPC fails', async () => {
    getOptionRequestsForAgencyMock.mockResolvedValue([makeAgencyOnlyRow()]);
    agencyConfirmJobAgencyOnlyMock.mockResolvedValue(false);

    await loadOptionRequestsForAgency('agency-1');
    const ok = await agencyConfirmJobAgencyOnlyStore(REQ_ID);

    expect(ok).toBe(false);
    expect(updateCalendarEntryToJobMock).not.toHaveBeenCalled();
    expect(ensureBookingSyncMock).not.toHaveBeenCalled();
  });
});
