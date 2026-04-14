/**
 * Tests für Counter-Offer Race Conditions & Stale Accept
 *
 * Audit finding C-2 / L-1: clientAcceptCounterPrice had no guard on
 * client_price_status = 'pending'. A stale UI or concurrent accept could
 * confirm an already-superseded price version.
 *
 * After the fix: the update includes .eq('client_price_status', 'pending')
 * .eq('final_status', 'option_pending') guards. If 0 rows are updated, the
 * function returns false.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

jest.mock('../../utils/logAction', () => ({
  logAction: jest.fn(() => true),
}));

import { supabase } from '../../../lib/supabase';
import { logAction } from '../../utils/logAction';
import {
  clientAcceptCounterPrice,
  setAgencyCounterOffer,
  agencyAcceptClientPrice,
  clientRejectCounterOfferOnSupabase,
} from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

/** Builds a chainable Supabase query mock that resolves to `result` at the terminal call. */
const makeChain = (result: unknown, terminalMethod = 'select') => {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['update', 'select', 'eq', 'neq', 'order', 'maybeSingle', 'single'];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => {
      if (m === terminalMethod) return Promise.resolve(result);
      if (m === 'maybeSingle' || m === 'single') return Promise.resolve(result);
      return chain;
    });
  });
  return chain;
};

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

// ─── clientAcceptCounterPrice ─────────────────────────────────────────────────
// EXPLOIT-C1 fix: now routes through SECURITY DEFINER RPC client_accept_counter_offer().
// Tests mock supabase.rpc() instead of supabase.from().

describe('clientAcceptCounterPrice — RPC route (EXPLOIT-C1 fix)', () => {
  it('returns true when the RPC returns true (counter-offer still pending)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith('client_accept_counter_offer', { p_request_id: 'req-1' });
  });

  it('returns false when the RPC returns false (stale accept — offer already changed)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('counter-offer no longer pending'),
      'req-1',
    );
  });

  it('returns false on RPC error (e.g. role validation failed)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'caller is not the client' } });
    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    rpc.mockRejectedValue(new Error('network error'));
    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('correctly rejects a double-accept scenario (second RPC call returns false)', async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    const [first, second] = await Promise.all([
      clientAcceptCounterPrice('req-1'),
      clientAcceptCounterPrice('req-1'),
    ]);

    expect([first, second]).toContain(true);
    expect([first, second]).toContain(false);
  });
});

// ─── setAgencyCounterOffer ────────────────────────────────────────────────────

describe('setAgencyCounterOffer', () => {
  const mockLockSuccess = () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'acquire_option_request_lock') {
        return { throwOnError: () => Promise.resolve({ data: null, error: null }) };
      }
      return Promise.resolve({ data: null, error: null });
    });
  };

  it('returns true when request is in_negotiation (1 row updated)', async () => {
    mockLockSuccess();
    const chain = makeChain(
      {
        data: {
          id: 'req-1',
          agency_id: 'agency-row-1',
          agency_organization_id: 'agency-org-uuid',
        },
        error: null,
      },
      'maybeSingle',
    );
    from.mockReturnValue(chain);

    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(true);
  });

  it('returns false when request is already confirmed (0 rows — status guard fires)', async () => {
    mockLockSuccess();
    const chain = makeChain({ data: null, error: null }, 'maybeSingle');
    from.mockReturnValue(chain);

    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not in_negotiation'),
      'req-1',
    );
  });

  it('returns false on DB error', async () => {
    mockLockSuccess();
    const chain = makeChain(
      { data: null, error: { message: 'constraint violation' } },
      'maybeSingle',
    );
    from.mockReturnValue(chain);

    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns false when advisory lock fails', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'acquire_option_request_lock') {
        return { throwOnError: () => Promise.reject(new Error('lock timeout')) };
      }
      return Promise.resolve({ data: null, error: null });
    });

    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── agencyAcceptClientPrice ──────────────────────────────────────────────────
// EXPLOIT-C1 fix: now routes through SECURITY DEFINER RPC agency_confirm_client_price().
// Tests mock supabase.rpc() instead of supabase.from().

describe('agencyAcceptClientPrice — RPC route (EXPLOIT-C1 fix)', () => {
  it('returns true when the RPC returns true (agency member, offer still pending)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    from.mockReturnValue(
      makeChain(
        {
          data: { agency_id: 'ag-1', agency_organization_id: 'agency-org-audit' },
          error: null,
        },
        'maybeSingle',
      ),
    );
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith('agency_confirm_client_price', { p_request_id: 'req-1' });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(logAction).toHaveBeenCalledWith(
      'agency-org-audit',
      'agencyAcceptClientPrice',
      expect.objectContaining({
        type: 'option',
        action: 'option_price_accepted',
        entityId: 'req-1',
      }),
    );
  });

  it('returns false when the RPC returns false (offer already changed / not in expected state)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not in expected state'),
      'req-1',
    );
  });

  it('returns false on RPC error (e.g. caller is not an agency member)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'caller is not a member of the agency' },
    });
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    rpc.mockRejectedValue(new Error('network timeout'));
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── clientRejectCounterOfferOnSupabase ───────────────────────────────────────
// Routes through SECURITY DEFINER RPC client_reject_counter_offer (20260550).

describe('clientRejectCounterOfferOnSupabase', () => {
  it('returns true on success (RPC true)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    from.mockReturnValue(
      makeChain(
        { data: { organization_id: 'client-org', client_organization_id: null }, error: null },
        'maybeSingle',
      ),
    );
    expect(await clientRejectCounterOfferOnSupabase('req-1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('client_reject_counter_offer', { p_request_id: 'req-1' });
  });

  it('returns false on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    expect(await clientRejectCounterOfferOnSupabase('req-1')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('returns false when RPC returns false (wrong state / idempotency)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await clientRejectCounterOfferOnSupabase('confirmed-req')).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not pending counter'),
      'confirmed-req',
    );
  });
});
