/**
 * Tests for consentSupabase.ts
 *
 * Covers GDPR Art. 7 consent management:
 *   1. recordConsent      — inserts consent record, returns false on error
 *   2. hasActiveConsent   — active (non-withdrawn) consent check
 *   3. withdrawConsent    — calls withdraw_consent RPC, ServiceResult
 *   4. anonymizeUserData  — calls anonymize_user_data RPC, fail-closed
 */

const mockRpc  = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc:  (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

import {
  recordConsent,
  hasActiveConsent,
  withdrawConsent,
  anonymizeUserData,
} from '../consentSupabase';

/** Builds a chainable query mock that resolves at maybeSingle. */
const makeQueryChain = (result: unknown) => ({
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  eq:     jest.fn().mockReturnThis(),
  is:     jest.fn().mockReturnThis(),
  limit:  jest.fn().mockReturnThis(),
  maybeSingle: jest.fn().mockResolvedValue(result),
});

let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

// ─── 1. recordConsent ─────────────────────────────────────────────────────────

describe('recordConsent', () => {
  it('returns true when insert succeeds', async () => {
    mockFrom.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) });

    const result = await recordConsent('user-1', 'terms', '1.0');

    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('consent_log');
  });

  it('returns false and logs error when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: { message: 'rls_violation' } }),
    });

    const result = await recordConsent('user-1', 'privacy', '1.0');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('recordConsent'), expect.any(Object));
  });

  it('returns false on exception (fail-closed)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('network'); });

    const result = await recordConsent('user-1', 'image_rights', '1.0');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('passes ip_address correctly', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    await recordConsent('user-1', 'marketing', '1.0', '1.2.3.4');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ ip_address: '1.2.3.4' }),
    );
  });
});

// ─── 2. hasActiveConsent ──────────────────────────────────────────────────────

describe('hasActiveConsent', () => {
  it('returns true when an active (non-withdrawn) consent exists', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: { id: 'cl-1' }, error: null }));

    const result = await hasActiveConsent('user-1', 'terms', '1.0');

    expect(result).toBe(true);
  });

  it('returns false when consent exists but is withdrawn (data null)', async () => {
    mockFrom.mockReturnValue(makeQueryChain({ data: null, error: null }));

    const result = await hasActiveConsent('user-1', 'terms', '1.0');

    expect(result).toBe(false);
  });

  it('returns false on exception (fail-closed, does not throw)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db error'); });

    const result = await hasActiveConsent('user-1', 'privacy', '1.0');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('queries with is(withdrawn_at, null) to exclude withdrawn consents', async () => {
    const chain = makeQueryChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    await hasActiveConsent('user-1', 'terms', '1.0');

    expect(chain.is).toHaveBeenCalledWith('withdrawn_at', null);
  });
});

// ─── 3. withdrawConsent ───────────────────────────────────────────────────────

describe('withdrawConsent', () => {
  it('returns ok when RPC succeeds (GDPR Art. 7(3))', async () => {
    mockRpc.mockResolvedValue({ error: null });

    const result = await withdrawConsent('marketing');

    expect(result).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('withdraw_consent', {
      p_consent_type: 'marketing',
      p_reason:       null,
    });
  });

  it('passes withdrawal reason to the RPC', async () => {
    mockRpc.mockResolvedValue({ error: null });

    await withdrawConsent('analytics', 'User requested via settings');

    expect(mockRpc).toHaveBeenCalledWith('withdraw_consent', {
      p_consent_type: 'analytics',
      p_reason:       'User requested via settings',
    });
  });

  it('returns ok: false and logs error when RPC fails', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'unauthorized' } });

    const result = await withdrawConsent('terms');

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns ok: false on exception (fail-closed)', async () => {
    mockRpc.mockRejectedValue(new Error('connection refused'));

    const result = await withdrawConsent('privacy');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('connection refused');
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 4. anonymizeUserData ─────────────────────────────────────────────────────

describe('anonymizeUserData', () => {
  it('returns true when RPC succeeds', async () => {
    mockRpc.mockResolvedValue({ error: null });

    const result = await anonymizeUserData('user-1');

    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('anonymize_user_data', { p_user_id: 'user-1' });
  });

  it('returns false when RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'not_authorized' } });

    const result = await anonymizeUserData('user-1');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    mockRpc.mockRejectedValue(new Error('network'));

    const result = await anonymizeUserData('user-1');

    expect(result).toBe(false);
  });
});
