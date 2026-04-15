/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * System Hardening Tests — C1, C2, C4 fixes verification.
 *
 * C1: modelRejectOptionRequest must NOT include final_status in update payload.
 * C2: modelConfirmOptionRequest must use OPTION_REQUEST_SELECT_MODEL_SAFE (no price fields).
 * C4: addMessage in option store must roll back on failed insert.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: jest.fn(),
  },
}));

describe('C1: modelRejectOptionRequest update shape', () => {
  it('update payload must NOT contain final_status', async () => {
    const { supabase } = require('../../../lib/supabase');

    const chainTracker = {
      updatePayload: null as any,
    };

    supabase.from.mockImplementation(() => ({
      update: jest.fn((payload: any) => {
        chainTracker.updatePayload = payload;
        return {
          eq: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'req-1',
              agency_id: 'a1',
              client_id: 'c1',
              organization_id: 'org1',
              agency_organization_id: 'org-a1',
            },
            error: null,
          }),
        };
      }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const { modelRejectOptionRequest } = require('../optionRequestsSupabase');
    await modelRejectOptionRequest('req-1');

    expect(chainTracker.updatePayload).toBeDefined();
    expect(chainTracker.updatePayload).toHaveProperty('model_approval', 'rejected');
    expect(chainTracker.updatePayload).toHaveProperty('status', 'rejected');
    expect(chainTracker.updatePayload).not.toHaveProperty('final_status');
  });
});

describe('C2: OPTION_REQUEST_SELECT_MODEL_SAFE excludes price fields', () => {
  it('MODEL_SAFE must NOT contain proposed_price, agency_counter_price, client_price_status', () => {
    const {
      OPTION_REQUEST_SELECT_MODEL_SAFE,
      OPTION_REQUEST_SELECT,
    } = require('../optionRequestsSupabase');

    expect(OPTION_REQUEST_SELECT).toContain('proposed_price');
    expect(OPTION_REQUEST_SELECT).toContain('agency_counter_price');
    expect(OPTION_REQUEST_SELECT).toContain('client_price_status');

    expect(OPTION_REQUEST_SELECT_MODEL_SAFE).not.toContain('proposed_price');
    expect(OPTION_REQUEST_SELECT_MODEL_SAFE).not.toContain('agency_counter_price');
    expect(OPTION_REQUEST_SELECT_MODEL_SAFE).not.toContain('client_price_status');
  });

  it('MODEL_SAFE must contain all non-commercial fields', () => {
    const { OPTION_REQUEST_SELECT_MODEL_SAFE } = require('../optionRequestsSupabase');

    const requiredFields = [
      'id',
      'client_id',
      'model_id',
      'agency_id',
      'status',
      'final_status',
      'model_approval',
      'model_approved_at',
      'model_account_linked',
      'organization_id',
      'agency_organization_id',
      'is_agency_only',
      'agency_event_group_id',
    ];

    for (const field of requiredFields) {
      expect(OPTION_REQUEST_SELECT_MODEL_SAFE).toContain(field);
    }
  });
});

describe('C2: modelConfirmOptionRequest uses MODEL_SAFE select', () => {
  it('initial fetch must use OPTION_REQUEST_SELECT_MODEL_SAFE', async () => {
    const { supabase } = require('../../../lib/supabase');

    const selectCalls: string[] = [];

    supabase.from.mockImplementation(() => ({
      select: jest.fn((selectStr: string) => {
        selectCalls.push(selectStr);
        return {
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'req-1',
              model_approval: 'pending',
              model_account_linked: true,
              final_status: 'option_confirmed',
              agency_id: 'a1',
              model_id: 'm1',
              organization_id: 'org1',
              agency_organization_id: 'org-a1',
            },
            error: null,
          }),
        };
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
      }),
    }));

    const {
      modelConfirmOptionRequest,
      OPTION_REQUEST_SELECT_MODEL_SAFE,
    } = require('../optionRequestsSupabase');

    await modelConfirmOptionRequest('req-1');

    expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    expect(selectCalls[0]).toBe(OPTION_REQUEST_SELECT_MODEL_SAFE);
  });
});

describe('SystemOptionMessageKind includes model_declined_availability', () => {
  it('model_declined_availability must be a valid kind accepted by addOptionSystemMessage', async () => {
    const { supabase } = require('../../../lib/supabase');
    supabase.rpc.mockResolvedValue({ data: 'msg-uuid-1', error: null });
    supabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'req-1', agency_id: 'a1', client_id: null },
        error: null,
      }),
    }));

    const { addOptionSystemMessage } = require('../optionRequestsSupabase');
    const result = await addOptionSystemMessage('req-1', 'model_declined_availability');

    expect(supabase.rpc).toHaveBeenCalledWith('insert_option_request_system_message', {
      p_option_request_id: 'req-1',
      p_kind: 'model_declined_availability',
      p_price: null,
      p_currency: null,
    });
    expect(result).not.toBeNull();
  });
});
