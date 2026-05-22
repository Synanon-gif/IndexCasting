/**
 * Regression: multi-model option requests for the same agency must each emit a B2B
 * booking card — MAT fallback must not skip the card when countryCodeUsedForBooking is null.
 */

const mockCreateBookingMessage = jest.fn().mockResolvedValue(true);

jest.mock('../../services/bookingChatIntegrationSupabase', () => ({
  createBookingMessageInClientAgencyChat: (...args: unknown[]) => mockCreateBookingMessage(...args),
}));

jest.mock('../../services/optionRequestsSupabase', () => ({
  insertOptionRequest: jest.fn(),
  addOptionMessage: jest.fn().mockResolvedValue(true),
  addOptionSystemMessage: jest.fn().mockResolvedValue(null),
  checkCalendarConflict: jest
    .fn()
    .mockResolvedValue({ has_conflict: false, conflicting_entries: [] }),
  resolveAgencyOrganizationIdForOptionRequest: jest.fn(),
}));

jest.mock('../../services/modelsSupabase', () => ({
  getModelByIdFromSupabase: jest.fn(),
}));

jest.mock('../../services/territoriesSupabase', () => ({
  resolveAgencyForModelAndCountry: jest.fn(),
}));

jest.mock('../../services/organizationsInvitationsSupabase', () => ({
  getMyClientMemberRole: jest.fn().mockResolvedValue({ organization_id: 'client-org-1' }),
  ensureClientOrganization: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'client-user-1' } } }) },
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() }),
    removeChannel: jest.fn(),
  },
}));

jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ default: {} }));
jest.mock('../../services/pushNotifications', () => ({
  registerPushNotifications: jest.fn(),
  deregisterPushNotifications: jest.fn(),
}));

import {
  insertOptionRequest,
  resolveAgencyOrganizationIdForOptionRequest,
} from '../../services/optionRequestsSupabase';
import { getModelByIdFromSupabase } from '../../services/modelsSupabase';
import { resolveAgencyForModelAndCountry } from '../../services/territoriesSupabase';
import { addOptionRequest, getOptionRequests } from '../optionRequests';

const mockInsert = insertOptionRequest as jest.Mock;
const mockGetModel = getModelByIdFromSupabase as jest.Mock;
const mockResolveMat = resolveAgencyForModelAndCountry as jest.Mock;
const mockResolveOrg = resolveAgencyOrganizationIdForOptionRequest as jest.Mock;

const AGENCY_ID = '11111111-1111-1111-1111-111111111111';
const MODEL_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MODEL_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQ_A = 'req-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REQ_B = 'req-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetModel.mockImplementation(async (id: string) => ({
    id,
    agency_id: AGENCY_ID,
    country_code: 'DE',
    user_id: 'model-user',
  }));
  mockResolveOrg.mockResolvedValue('agency-org-1');
  mockInsert.mockImplementation(async (payload: { model_id: string }) => ({
    id: payload.model_id === MODEL_A ? REQ_A : REQ_B,
    agency_id: AGENCY_ID,
    client_id: 'client-user-1',
    model_id: payload.model_id,
    requested_date: '2026-08-01',
    status: 'in_negotiation',
    request_type: 'option',
    model_account_linked: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
});

describe('addOptionRequest — multi-model B2B booking cards', () => {
  it('creates two option_requests and two B2B cards for two models (MAT fallback on second)', async () => {
    mockResolveMat.mockImplementation(async (modelId: string) =>
      modelId === MODEL_A ? AGENCY_ID : null,
    );

    addOptionRequest('Client Co', 'Model A', MODEL_A, '2026-08-01', undefined, {
      countryCode: 'DE',
      clientOrganizationName: 'Client Co',
    });
    addOptionRequest('Client Co', 'Model B', MODEL_B, '2026-08-01', undefined, {
      countryCode: 'DE',
      clientOrganizationName: 'Client Co',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls[0][0].model_id).toBe(MODEL_A);
    expect(mockInsert.mock.calls[1][0].model_id).toBe(MODEL_B);

    const cached = getOptionRequests();
    expect(cached.filter((r) => r.modelId === MODEL_A)).toHaveLength(1);
    expect(cached.filter((r) => r.modelId === MODEL_B)).toHaveLength(1);
    expect(cached[0]?.threadId).not.toBe(cached[1]?.threadId);

    expect(mockCreateBookingMessage).toHaveBeenCalledTimes(2);
    expect(mockCreateBookingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: MODEL_A,
        optionRequestId: REQ_A,
        countryCode: 'DE',
      }),
    );
    expect(mockCreateBookingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: MODEL_B,
        optionRequestId: REQ_B,
        countryCode: 'DE',
      }),
    );
  });

  it('creates B2B card for second model when MAT fallback clears country (no extra.countryCode)', async () => {
    mockResolveMat.mockImplementation(async (modelId: string) =>
      modelId === MODEL_A ? AGENCY_ID : null,
    );
    mockGetModel.mockImplementation(async (id: string) => ({
      id,
      agency_id: AGENCY_ID,
      country_code: id === MODEL_A ? 'DE' : null,
      user_id: 'model-user',
    }));

    addOptionRequest('Client Co', 'Model A', MODEL_A, '2026-08-01', undefined, {
      countryCode: 'DE',
      clientOrganizationName: 'Client Co',
    });
    addOptionRequest('Client Co', 'Model B', MODEL_B, '2026-08-01', undefined, {
      clientOrganizationName: 'Client Co',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateBookingMessage).toHaveBeenCalledTimes(2);
    expect(mockCreateBookingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: MODEL_B,
        optionRequestId: REQ_B,
        countryCode: '',
      }),
    );
  });

  it('duplicate guard blocks same model+slot but not a second model', async () => {
    mockResolveMat.mockResolvedValue(AGENCY_ID);

    const first = addOptionRequest('Client Co', 'Model A', MODEL_A, '2026-08-01');
    const duplicate = addOptionRequest('Client Co', 'Model A', MODEL_A, '2026-08-01');
    const secondModel = addOptionRequest('Client Co', 'Model B', MODEL_B, '2026-08-01', undefined, {
      countryCode: 'DE',
    });

    expect(first).not.toBe('');
    expect(duplicate).toBe('');
    expect(secondModel).not.toBe('');

    await new Promise((r) => setTimeout(r, 50));
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});
