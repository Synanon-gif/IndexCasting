jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

jest.mock('../bookingEventsSupabase', () => ({
  createBookingEvent: jest.fn(),
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(),
}));

import { supabase } from '../../../lib/supabase';
import { clientConfirmJobOnSupabase } from '../optionRequestsSupabase';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

describe('clientConfirmJobOnSupabase', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('returns false when RPC returns false', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(clientConfirmJobOnSupabase('req-1')).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith('client_confirm_option_job', { p_request_id: 'req-1' });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns true when RPC succeeds and row fetch works', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const row = {
      id: 'req-1',
      organization_id: 'org-1',
      agency_id: 'a1',
      model_id: 'm1',
      status: 'confirmed',
      final_status: 'job_confirmed',
      client_id: null,
      project_id: null,
      client_name: null,
      model_name: null,
      requested_date: '2026-04-01',
      request_type: 'option',
      currency: 'EUR',
      start_time: null,
      end_time: null,
      model_approval: 'approved',
      model_approved_at: null,
      model_account_linked: true,
      booker_id: null,
      agency_organization_id: null,
      client_organization_id: null,
      created_by: null,
      agency_assignee_user_id: null,
      created_at: '',
      updated_at: '',
      proposed_price: null,
      agency_counter_price: null,
      client_price_status: 'accepted',
    };
    from.mockImplementation((table: string) => {
      if (table === 'option_requests') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
            }),
          }),
        };
      }
      if (table === 'booking_events') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });
    await expect(clientConfirmJobOnSupabase('req-1')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('client_confirm_option_job', { p_request_id: 'req-1' });
  });
});
