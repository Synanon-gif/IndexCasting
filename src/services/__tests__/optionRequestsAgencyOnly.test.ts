/* eslint-disable @typescript-eslint/no-explicit-any */
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
} from '../optionRequestsSupabase';

const rpc = supabase.rpc as jest.Mock;

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
    expect(rpc).toHaveBeenCalledWith('agency_create_option_request', expect.objectContaining({
      p_model_id: 'model-1',
      p_agency_id: 'agency-1',
      p_requested_date: '2026-07-01',
      p_request_type: 'option',
      p_title: 'Summer Shoot',
    }));
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
