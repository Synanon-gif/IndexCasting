jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(() => true),
}));

import { supabase } from '../../../lib/supabase';
import { deleteOptionRequestFull } from '../optionRequestsSupabase';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

describe('deleteOptionRequestFull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockOptionRow(overrides: Partial<Record<string, unknown>> = {}) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'opt-1',
          client_id: 'c1',
          model_id: 'm1',
          agency_id: 'a1',
          requested_date: '2026-04-10',
          status: 'in_negotiation',
          project_id: null,
          client_name: null,
          model_name: null,
          proposed_price: null,
          agency_counter_price: null,
          client_price_status: null,
          final_status: 'option_pending',
          request_type: 'option',
          currency: null,
          start_time: null,
          end_time: null,
          model_approval: 'pending',
          model_approved_at: null,
          model_account_linked: true,
          booker_id: null,
          organization_id: 'org-client-1',
          agency_organization_id: null,
          client_organization_id: null,
          created_by: null,
          agency_assignee_user_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...overrides,
        },
        error: null,
      }),
    };
    from.mockReturnValue(chain);
  }

  it('returns false when row has final_status job_confirmed', async () => {
    mockOptionRow({ final_status: 'job_confirmed' });
    await expect(deleteOptionRequestFull('opt-1')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls delete_option_request_full RPC and returns true on success', async () => {
    mockOptionRow();
    rpc.mockResolvedValue({ error: null });
    await expect(deleteOptionRequestFull('opt-1')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('delete_option_request_full', {
      p_option_request_id: 'opt-1',
    });
  });

  it('returns false when RPC errors', async () => {
    mockOptionRow();
    rpc.mockResolvedValue({ error: { message: 'access_denied' } });
    await expect(deleteOptionRequestFull('opt-1')).resolves.toBe(false);
  });

  it('returns false when option row not found', async () => {
    from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(deleteOptionRequestFull('missing')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
