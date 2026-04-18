/**
 * Tests für den Booking Confirmation Flow:
 *   - agencyAcceptRequest: direkte Bestätigung (kein Account) vs. wartend auf Model
 *   - agencyRejectRequest: Anfrage ablehnen
 *   - modelConfirmOptionRequest: Model bestätigt, booking_event wird erstellt
 *   - modelRejectOptionRequest: Model lehnt ab
 *   - getPendingModelConfirmations: Korrekte Filter-Logik
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

jest.mock('../bookingEventsSupabase', () => ({
  createBookingEvent: jest.fn().mockResolvedValue({ id: 'be-1' }),
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(() => true),
}));

import { supabase } from '../../../lib/supabase';
import { logAction } from '../../utils/logAction';
import { createBookingEvent } from '../bookingEventsSupabase';
import {
  agencyAcceptRequest,
  agencyRejectRequest,
  modelConfirmOptionRequest,
  modelRejectOptionRequest,
  getPendingModelConfirmations,
  clientConfirmJobOnSupabase,
} from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
const mockCreateBookingEvent = createBookingEvent as jest.Mock;

const BASE_REQUEST = {
  id: 'req-1',
  model_id: 'model-1',
  agency_id: 'agency-1',
  client_id: 'client-1',
  requested_date: '2026-04-01',
  status: 'in_negotiation' as const,
  model_approval: 'pending' as const,
  model_account_linked: true,
  organization_id: 'org-1',
  request_type: 'option' as const,
  final_status: 'option_pending' as const,
  client_price_status: 'pending' as const,
  client_name: 'Brand X',
  model_name: 'Anna B',
  proposed_price: 1000,
  agency_counter_price: null,
  currency: 'EUR',
  start_time: '10:00',
  end_time: '18:00',
  model_approved_at: null,
  booker_id: null,
  created_by: null,
  agency_assignee_user_id: null,
  project_id: null,
  created_at: '2026-03-27T10:00:00Z',
  updated_at: '2026-03-27T10:00:00Z',
  /** Agency B2B org — must be used for agency-actor audit (not organization_id / client org). */
  agency_organization_id: 'agency-b2b-org-1',
};

describe('agencyAcceptRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('returns null when fetch fails', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
        }),
      }),
    });
    await expect(agencyAcceptRequest('req-1')).resolves.toBeNull();
  });

  it('returns awaiting_model_confirmation when model has account', async () => {
    const reqWithAccount = { ...BASE_REQUEST, model_account_linked: true };

    // Update chain: .update().eq(id).eq(status,'in_negotiation').select('id').maybeSingle()
    const updateChain: any = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
    };

    from
      .mockReturnValueOnce({
        // fetch option_request
        select: () => ({
          eq: () => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: reqWithAccount, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        // update option_request (with model account → awaiting confirmation)
        update: () => updateChain,
      });

    const result = await agencyAcceptRequest('req-1');
    expect(result).toBe('awaiting_model_confirmation');
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith(
      'agency-b2b-org-1',
      'agencyAcceptRequest:awaiting-model',
      expect.objectContaining({
        type: 'option',
        action: 'option_confirmed',
        entityId: 'req-1',
      }),
    );
  });

  it('returns confirmed when model has no account (booking_event created by DB trigger)', async () => {
    const reqNoAccount = { ...BASE_REQUEST, model_account_linked: false };

    // Update chain: .update().eq(id).eq(status,'in_negotiation').select('id').maybeSingle()
    const updateChain: any = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
    };

    from
      .mockReturnValueOnce({
        // fetch option_request
        select: () => ({
          eq: () => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: reqNoAccount, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        // update option_request
        update: () => updateChain,
      });
    // Note: No 3rd mock needed — createBookingEventFromRequest is now handled by
    // the DB trigger tr_auto_booking_event_on_confirm (migration_chaos_hardening_2026_04.sql).
    // The client-side call was removed from agencyAcceptRequest.

    const result = await agencyAcceptRequest('req-1');
    expect(result).toBe('confirmed');
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith(
      'agency-b2b-org-1',
      'agencyAcceptRequest:no-account',
      expect.objectContaining({ type: 'option', action: 'option_confirmed', entityId: 'req-1' }),
    );
  });

  it('returns null on second accept when update matches no row (double-click idempotency)', async () => {
    const reqNoAccount = { ...BASE_REQUEST, model_account_linked: false };
    const maybeSingle = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'req-1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const updateChain: any = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle,
    };
    let fromCall = 0;
    from.mockImplementation(() => {
      fromCall += 1;
      if (fromCall % 2 === 1) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: reqNoAccount, error: null }),
            }),
          }),
        };
      }
      return { update: () => updateChain };
    });

    await expect(agencyAcceptRequest('req-1')).resolves.toBe('confirmed');
    await expect(agencyAcceptRequest('req-1')).resolves.toBeNull();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });
});

describe('agencyRejectRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns true on success', async () => {
    // Chain: update → eq('id') → eq('status','in_negotiation') → select → maybeSingle
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'req-1',
        client_id: null,
        organization_id: 'client-org-1',
        agency_id: 'agency-1',
        agency_organization_id: 'agency-b2b-org-1',
      },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eqStatus = jest.fn().mockReturnValue({ select });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    from.mockReturnValue({ update: () => ({ eq: eqId }) });
    await expect(agencyRejectRequest('req-1')).resolves.toBe(true);
    expect(logAction).toHaveBeenCalledWith(
      'agency-b2b-org-1',
      'agencyRejectRequest',
      expect.objectContaining({ type: 'option', action: 'option_rejected', entityId: 'req-1' }),
    );
  });

  it('returns false on DB error', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'error' } });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eqStatus = jest.fn().mockReturnValue({ select });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    from.mockReturnValue({ update: () => ({ eq: eqId }) });
    await expect(agencyRejectRequest('req-1')).resolves.toBe(false);
  });
});

describe('modelConfirmOptionRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  // Use resetAllMocks (not just clearAllMocks) to also drain mockReturnValueOnce queues,
  // preventing cross-test mock leakage when tests short-circuit early.
  beforeEach(() => {
    jest.resetAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // A request where the agency has already accepted (final_status = option_confirmed),
  // which is the required precondition before the model can confirm.
  const AGENCY_ACCEPTED_REQUEST = {
    ...BASE_REQUEST,
    final_status: 'option_confirmed' as const,
    client_price_status: 'accepted' as const,
  };

  it('returns false when model_approval is not pending', async () => {
    const alreadyApproved = { ...AGENCY_ACCEPTED_REQUEST, model_approval: 'approved' as const };
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: alreadyApproved, error: null }),
        }),
      }),
    });
    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
  });

  it('returns false when model_account_linked is false', async () => {
    const noAccount = { ...AGENCY_ACCEPTED_REQUEST, model_account_linked: false };
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: noAccount, error: null }),
        }),
      }),
    });
    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
  });

  it('returns false when agency has not accepted yet (final_status = option_pending)', async () => {
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: BASE_REQUEST, error: null }),
        }),
      }),
    });
    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
  });

  it('returns true on success (booking_event now created by DB trigger)', async () => {
    // Chain: update → eq(id) → eq(model_approval) → eq(final_status) → select → maybeSingle
    const maybeSingleConfirm = jest.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null });
    const selectConfirm = jest.fn().mockReturnValue({ maybeSingle: maybeSingleConfirm });

    const eqConfirm: jest.Mock = jest
      .fn()
      .mockImplementation(() => ({ eq: eqConfirm, select: selectConfirm }));

    from
      .mockReturnValueOnce({
        // fetch option_request (agency already accepted → final_status = option_confirmed)
        select: () => ({
          eq: () => ({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({ data: AGENCY_ACCEPTED_REQUEST, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        // update with multi-eq race-condition guard chain
        update: () => ({ eq: eqConfirm }),
      });

    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(true);
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
  });

  it('returns false on DB error during update', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } });
    const select = jest.fn().mockReturnValue({ maybeSingle });

    const eqChain: jest.Mock = jest.fn().mockImplementation(() => ({ eq: eqChain, select }));

    from
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({ data: AGENCY_ACCEPTED_REQUEST, error: null }),
          }),
        }),
      })
      .mockReturnValueOnce({
        update: () => ({ eq: eqChain }),
      });

    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
  });
});

describe('modelRejectOptionRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('returns true on success', async () => {
    // Chain: update → eq(id) → eq(model_approval) → eq(final_status) → eq(status) → select → maybeSingle
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });

    const eqChain: jest.Mock = jest.fn().mockImplementation(() => ({ eq: eqChain, select }));
    from.mockReturnValue({ update: () => ({ eq: eqChain }) });
    await expect(modelRejectOptionRequest('req-1')).resolves.toBe(true);
    expect(eqChain).toHaveBeenCalledWith('id', 'req-1');
    expect(eqChain).toHaveBeenCalledWith('model_approval', 'pending');
    expect(eqChain).toHaveBeenCalledWith('final_status', 'option_confirmed');
    expect(eqChain).toHaveBeenCalledWith('status', 'in_negotiation');
  });

  it('returns false on DB error', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'error' } });
    const select = jest.fn().mockReturnValue({ maybeSingle });

    const eqChain: jest.Mock = jest.fn().mockImplementation(() => ({ eq: eqChain, select }));
    from.mockReturnValue({ update: () => ({ eq: eqChain }) });
    await expect(modelRejectOptionRequest('req-1')).resolves.toBe(false);
  });

  it('returns false when no row updated (concurrent state change)', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });

    const eqChain: jest.Mock = jest.fn().mockImplementation(() => ({ eq: eqChain, select }));
    from.mockReturnValue({ update: () => ({ eq: eqChain }) });
    await expect(modelRejectOptionRequest('req-1')).resolves.toBe(false);
  });
});

describe('clientConfirmJobOnSupabase', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('returns false when RPC returns false (idempotent / guards)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(clientConfirmJobOnSupabase('req-1')).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith('client_confirm_option_job', { p_request_id: 'req-1' });
    expect(from).not.toHaveBeenCalled();
  });

  it('second call with RPC false does not hit post-RPC fetch', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(clientConfirmJobOnSupabase('req-1')).resolves.toBe(false);
    await expect(clientConfirmJobOnSupabase('req-1')).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('getPendingModelConfirmations', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns array of pending confirmation requests', async () => {
    const order = jest.fn().mockResolvedValue({ data: [BASE_REQUEST], error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ order }),
              }),
            }),
          }),
        }),
      }),
    });
    const result = await getPendingModelConfirmations('model-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('req-1');
  });

  it('returns empty array on error', async () => {
    const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ order }),
              }),
            }),
          }),
        }),
      }),
    });
    const result = await getPendingModelConfirmations('model-1');
    expect(result).toEqual([]);
  });
});
