/**
 * Tests for agency-only manual event flow:
 *   - insertAgencyOptionRequest: creates an option request via agency_create_option_request RPC
 *   - agencyConfirmJobAgencyOnly: confirms job only when is_agency_only=true and model approved
 *   - Canonical invariant: agencyConfirmJobAgencyOnly rejects non-agency-only requests
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  insertAgencyOptionRequest,
  agencyConfirmJobAgencyOnly,
  ensureBookingEventSyncedFromOptionRequest,
} from '../optionRequestsSupabase';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('insertAgencyOptionRequest', () => {
  it('calls agency_create_option_request RPC and returns the new request id', async () => {
    rpc.mockResolvedValueOnce({ data: 'new-req-uuid', error: null });
    const result = await insertAgencyOptionRequest({
      modelId: 'model-1',
      agencyId: 'agency-1',
      requestedDate: '2026-07-01',
      requestType: 'option',
      title: 'Summer Shoot',
    });
    expect(rpc).toHaveBeenCalledWith(
      'agency_create_option_request',
      expect.objectContaining({
        p_model_id: 'model-1',
        p_agency_id: 'agency-1',
        p_requested_date: '2026-07-01',
        p_request_type: 'option',
        p_title: 'Summer Shoot',
      }),
    );
    expect(result).toBe('new-req-uuid');
  });

  it('returns null on RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'access_denied' } });
    const result = await insertAgencyOptionRequest({
      modelId: 'model-1',
      agencyId: 'agency-1',
      requestedDate: '2026-07-01',
    });
    expect(result).toBeNull();
  });

  it('returns null on exception', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    const result = await insertAgencyOptionRequest({
      modelId: 'model-1',
      agencyId: 'agency-1',
      requestedDate: '2026-07-01',
    });
    expect(result).toBeNull();
  });
});

describe('ensureBookingEventSyncedFromOptionRequest', () => {
  it('loads option row and upserts booking_events when job_confirmed', async () => {
    const reqId = 'req-job-sync';
    const row = {
      id: reqId,
      client_id: 'client-1',
      model_id: 'model-1',
      agency_id: 'agency-1',
      requested_date: '2026-05-26',
      status: 'confirmed',
      project_id: null,
      client_name: null,
      model_name: 'RÉMI',
      job_description: null,
      proposed_price: null,
      agency_counter_price: null,
      client_price_status: null,
      final_status: 'job_confirmed',
      request_type: 'option',
      currency: 'EUR',
      start_time: null,
      end_time: null,
      model_approval: 'approved',
      model_approved_at: null,
      model_account_linked: true,
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    from.mockImplementation((table: string) => {
      if (table === 'option_requests') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
            }),
          }),
        };
      }
      if (table === 'booking_events') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              neq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'organizations') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { id: 'org-agency-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    await ensureBookingEventSyncedFromOptionRequest(reqId);
    expect(from).toHaveBeenCalledWith('booking_events');
  });
});

describe('agencyConfirmJobAgencyOnly', () => {
  it('calls RPC and returns true on success', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const result = await agencyConfirmJobAgencyOnly('req-1');
    expect(rpc).toHaveBeenCalledWith('agency_confirm_job_agency_only', { p_request_id: 'req-1' });
    expect(result).toBe(true);
  });

  it('returns false on RPC error (e.g., not agency-only)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_agency_only' } });
    const result = await agencyConfirmJobAgencyOnly('req-1');
    expect(result).toBe(false);
  });

  it('returns false on exception', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    const result = await agencyConfirmJobAgencyOnly('req-1');
    expect(result).toBe(false);
  });
});
