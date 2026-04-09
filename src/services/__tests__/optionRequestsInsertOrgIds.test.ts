/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * insertOptionRequest: empty-string org IDs must not be sent (RLS WITH CHECK).
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { insertOptionRequest } from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;

describe('insertOptionRequest — org id normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps blank organization_id / client_organization_id / agency_organization_id to null in insert payload', async () => {
    const insertMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'orq-1',
            client_id: 'c1',
            model_id: 'm1',
            agency_id: 'a1',
            requested_date: '2026-06-01',
            status: 'in_negotiation',
            project_id: null,
            client_name: null,
            model_name: null,
            proposed_price: null,
            agency_counter_price: null,
            client_price_status: 'pending',
            final_status: 'option_pending',
            request_type: 'option',
            currency: null,
            start_time: null,
            end_time: null,
            model_approval: 'approved',
            model_approved_at: null,
            model_account_linked: false,
            booker_id: null,
            organization_id: null,
            agency_organization_id: null,
            client_organization_id: null,
            created_by: null,
            agency_assignee_user_id: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          error: null,
        }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === 'models') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: null }, error: null }),
            }),
          }),
        };
      }
      if (table === 'option_requests') {
        return { insert: insertMock };
      }
      return {};
    });

    await insertOptionRequest({
      client_id: 'c1',
      model_id: 'm1',
      agency_id: 'a1',
      requested_date: '2026-06-01',
      organization_id: '   ',
      client_organization_id: '',
      agency_organization_id: '  ',
    });

    expect(insertMock).toHaveBeenCalled();
    const payload = insertMock.mock.calls[0][0];
    expect(payload.organization_id).toBeNull();
    expect(payload.client_organization_id).toBeNull();
    expect(payload.agency_organization_id).toBeNull();
  });
});
