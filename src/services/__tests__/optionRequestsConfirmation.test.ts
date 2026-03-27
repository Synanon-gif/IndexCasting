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
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

jest.mock('../bookingEventsSupabase', () => ({
  createBookingEvent: jest.fn().mockResolvedValue({ id: 'be-1' }),
}));

import { supabase } from '../../../lib/supabase';
import { createBookingEvent } from '../bookingEventsSupabase';
import {
  agencyAcceptRequest,
  agencyRejectRequest,
  modelConfirmOptionRequest,
  modelRejectOptionRequest,
  getPendingModelConfirmations,
} from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;
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
    let callIdx = 0;
    from.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // fetch option_request
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: reqWithAccount, error: null }),
            }),
          }),
        };
      }
      // update call
      return {
        update: () => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: reqWithAccount, error: null }),
        }),
      }),
    }).mockReturnValueOnce({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });

    const result = await agencyAcceptRequest('req-1');
    expect(result).toBe('awaiting_model_confirmation');
    expect(mockCreateBookingEvent).not.toHaveBeenCalled();
  });

  it('returns confirmed and creates booking_event when model has no account', async () => {
    const reqNoAccount = { ...BASE_REQUEST, model_account_linked: false };

    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: reqNoAccount, error: null }),
        }),
      }),
    })
    .mockReturnValueOnce({
      // update option_request
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })
    .mockReturnValueOnce({
      // fetch organizations for booking_event
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'org-agency-1' }, error: null }),
        }),
      }),
    });

    const result = await agencyAcceptRequest('req-1');
    expect(result).toBe('confirmed');
    expect(mockCreateBookingEvent).toHaveBeenCalledTimes(1);
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
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    await expect(agencyRejectRequest('req-1')).resolves.toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'error' } }),
      }),
    });
    await expect(agencyRejectRequest('req-1')).resolves.toBe(false);
  });
});

describe('modelConfirmOptionRequest', () => {
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

  it('returns false when model_approval is not pending', async () => {
    const alreadyApproved = { ...BASE_REQUEST, model_approval: 'approved' as const };
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
    const noAccount = { ...BASE_REQUEST, model_account_linked: false };
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: noAccount, error: null }),
        }),
      }),
    });
    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
  });

  it('returns true and creates booking_event on success', async () => {
    from.mockReturnValueOnce({
      // fetch option_request
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: BASE_REQUEST, error: null }),
        }),
      }),
    })
    .mockReturnValueOnce({
      // update
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })
    .mockReturnValueOnce({
      // fetch org for booking_event
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'org-agency-1' }, error: null }),
        }),
      }),
    });

    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(true);
    expect(mockCreateBookingEvent).toHaveBeenCalledTimes(1);
  });

  it('returns false on DB error during update', async () => {
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: BASE_REQUEST, error: null }),
        }),
      }),
    })
    .mockReturnValueOnce({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'rls' } }),
      }),
    });

    await expect(modelConfirmOptionRequest('req-1')).resolves.toBe(false);
  });
});

describe('modelRejectOptionRequest', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns true on success', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    await expect(modelRejectOptionRequest('req-1')).resolves.toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'error' } }),
      }),
    });
    await expect(modelRejectOptionRequest('req-1')).resolves.toBe(false);
  });
});

describe('getPendingModelConfirmations', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
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
              neq: () => ({ order }),
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
              neq: () => ({ order }),
            }),
          }),
        }),
      }),
    });
    const result = await getPendingModelConfirmations('model-1');
    expect(result).toEqual([]);
  });
});
