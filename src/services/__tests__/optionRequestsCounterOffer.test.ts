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
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  clientAcceptCounterPrice,
  setAgencyCounterOffer,
  agencyAcceptClientPrice,
  clientRejectCounterOfferOnSupabase,
} from '../optionRequestsSupabase';

const from = supabase.from as jest.Mock;

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
  consoleWarnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// ─── clientAcceptCounterPrice ─────────────────────────────────────────────────

describe('clientAcceptCounterPrice — optimistic guard', () => {
  it('returns true when the counter-offer is still pending (1 row updated)', async () => {
    // DB returns data with 1 row → update succeeded
    const chain = makeChain({ data: [{ id: 'req-1' }], error: null });
    from.mockReturnValue(chain);

    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(true);
  });

  it('returns false when counter-offer was already accepted (0 rows updated — stale accept)', async () => {
    // DB returns empty data → the WHERE guards on client_price_status='pending'
    // and final_status='option_pending' matched 0 rows (stale / already changed).
    const chain = makeChain({ data: [], error: null });
    from.mockReturnValue(chain);

    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('counter-offer no longer pending'),
    );
  });

  it('returns false when counter-offer was rejected by another session (null data)', async () => {
    const chain = makeChain({ data: null, error: null });
    from.mockReturnValue(chain);

    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
  });

  it('returns false on DB error', async () => {
    const chain = makeChain({ data: null, error: { message: 'rls violation' } });
    from.mockReturnValue(chain);

    const result = await clientAcceptCounterPrice('req-1');
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('correctly rejects a double-accept scenario (second call returns 0 rows)', async () => {
    // First accept: 1 row updated → succeeds
    const firstChain = makeChain({ data: [{ id: 'req-1' }], error: null });
    // Second accept (race): 0 rows because client_price_status is now 'accepted'
    const secondChain = makeChain({ data: [], error: null });

    from.mockReturnValueOnce(firstChain).mockReturnValueOnce(secondChain);

    const [first, second] = await Promise.all([
      clientAcceptCounterPrice('req-1'),
      clientAcceptCounterPrice('req-1'),
    ]);

    // Only one should succeed; the other is blocked by the guard
    expect([first, second]).toContain(true);
    expect([first, second]).toContain(false);
  });
});

// ─── setAgencyCounterOffer ────────────────────────────────────────────────────

describe('setAgencyCounterOffer', () => {
  it('returns true on successful counter-offer creation', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'constraint violation' } }),
      }),
    });
    const result = await setAgencyCounterOffer('req-1', 2500);
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// ─── agencyAcceptClientPrice ──────────────────────────────────────────────────

describe('agencyAcceptClientPrice', () => {
  it('returns true on success', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'rls' } }),
      }),
    });
    const result = await agencyAcceptClientPrice('req-1');
    expect(result).toBe(false);
  });
});

// ─── clientRejectCounterOfferOnSupabase ───────────────────────────────────────

describe('clientRejectCounterOfferOnSupabase', () => {
  it('returns true on success', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    const result = await clientRejectCounterOfferOnSupabase('req-1');
    expect(result).toBe(true);
  });

  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: () => ({
        eq: jest.fn().mockResolvedValue({ error: { message: 'timeout' } }),
      }),
    });
    const result = await clientRejectCounterOfferOnSupabase('req-1');
    expect(result).toBe(false);
  });
});
