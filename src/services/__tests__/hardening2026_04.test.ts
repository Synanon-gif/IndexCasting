/**
 * Security Hardening Tests — 2026-04 Audit Fixes
 *
 * Covers the scenarios introduced or tightened by migration_hardening_2026_04_final.sql
 * and the corresponding TypeScript service fixes:
 *
 *   VULN-H2  — agencyRejectRequest / clientRejectCounterOfferOnSupabase: status guards
 *   VULN-M3  — resolveOptionDocumentUrl: path-based signed URL generation
 *   VULN-M4  — writeAdminLog: error is caught and logged (no silent swallow)
 *   VULN-M5  — getGuestLinksForAgency / deactivateGuestLink: exception safety
 *   PERF-M7  — getAgencyRevenue: calls RPC, not JS reduce
 *   PERF-M2  — getBookingsForAgency uses .range() for pagination
 *
 * State-machine trigger (VULN-H1) is enforced in Postgres. The TS-side we test
 * that the service propagates the DB exception cleanly as a `false` / null return.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from:    jest.fn(),
    rpc:     jest.fn(),
    storage: { from: jest.fn() },
    auth:    { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-user-1' } } }) },
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  agencyRejectRequest,
  clientRejectCounterOfferOnSupabase,
  resolveOptionDocumentUrl,
  type SupabaseOptionDocument,
} from '../optionRequestsSupabase';
import { writeAdminLog }             from '../adminSupabase';
import { getGuestLinksForAgency, deactivateGuestLink } from '../guestLinksSupabase';
import { getAgencyRevenue, getBookingsForAgency }      from '../bookingsSupabase';

const from    = supabase.from    as jest.Mock;
const rpc     = supabase.rpc     as jest.Mock;
const storage = supabase.storage as unknown as { from: jest.Mock };

/** Builds a chainable mock that terminates at `terminalMethod`. */
const chain = (result: unknown, ...terminalMethods: string[]) => {
  const methods = ['update', 'select', 'eq', 'neq', 'in', 'order', 'range',
                   'maybeSingle', 'single', 'insert', 'is', 'limit'];
  const obj: Record<string, jest.Mock> = {};
  methods.forEach((m) => {
    obj[m] = jest.fn(() => {
      if (terminalMethods.includes(m)) return Promise.resolve(result);
      if (m === 'maybeSingle' || m === 'single') return Promise.resolve(result);
      return obj;
    });
  });
  return obj;
};

let errSpy:  jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

// ─── VULN-H2: agencyRejectRequest status guard ───────────────────────────────

describe('agencyRejectRequest — VULN-H2 status guard', () => {
  it('returns true when request is in_negotiation (happy path)', async () => {
    from.mockReturnValue(chain({ data: { id: 'req-1' }, error: null }, 'maybeSingle'));
    expect(await agencyRejectRequest('req-1')).toBe(true);
  });

  it('returns false and warns when request is already confirmed (0 rows updated)', async () => {
    from.mockReturnValue(chain({ data: null, error: null }, 'maybeSingle'));
    expect(await agencyRejectRequest('confirmed-req')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no row updated'),
      'confirmed-req',
    );
  });

  it('returns false when DB returns an error (e.g. trigger rejection)', async () => {
    from.mockReturnValue(chain({ data: null, error: { message: 'Cannot change status from rejected' } }, 'maybeSingle'));
    expect(await agencyRejectRequest('rejected-req')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns false on exception (network failure)', async () => {
    from.mockImplementation(() => { throw new Error('network'); });
    expect(await agencyRejectRequest('req-1')).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('exception'),
      expect.any(Error),
    );
  });
});

// ─── VULN-H2: clientRejectCounterOfferOnSupabase — RPC client_reject_counter_offer

describe('clientRejectCounterOfferOnSupabase — RPC guard', () => {
  it('returns true when RPC succeeds (happy path)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    from.mockReturnValue(
      chain({ data: { organization_id: 'c-org', client_organization_id: null }, error: null }, 'maybeSingle'),
    );
    expect(await clientRejectCounterOfferOnSupabase('req-1')).toBe(true);
  });

  it('returns false and warns when RPC returns false (wrong state)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await clientRejectCounterOfferOnSupabase('confirmed-req')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not pending counter'),
      'confirmed-req',
    );
  });

  it('returns false on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rls violation' } });
    expect(await clientRejectCounterOfferOnSupabase('req-1')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('double-reject returns false on second call (idempotency)', async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    from.mockReturnValue(
      chain({ data: { organization_id: 'c-org', client_organization_id: null }, error: null }, 'maybeSingle'),
    );
    await clientRejectCounterOfferOnSupabase('req-1');
    expect(await clientRejectCounterOfferOnSupabase('req-1')).toBe(false);
  });
});

// ─── VULN-M3: resolveOptionDocumentUrl ───────────────────────────────────────

const makeDoc = (file_url: string): SupabaseOptionDocument => ({
  id: 'doc-1',
  option_request_id: 'req-1',
  uploaded_by: 'user-1',
  file_name: 'brief.pdf',
  file_url,
  file_type: 'pdf',
  created_at: '2026-04-01T10:00:00Z',
});

describe('resolveOptionDocumentUrl — VULN-M3', () => {
  it('returns a fresh signed URL for a storage path', async () => {
    const signedUrl = 'https://supabase.co/storage/v1/signed/abc123';
    storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl }, error: null }),
    });
    const result = await resolveOptionDocumentUrl(makeDoc('options/req-1/1712000000_brief.pdf'));
    expect(result).toBe(signedUrl);
  });

  it('returns legacy https URL as-is without calling storage', async () => {
    const legacyUrl = 'https://supabase.co/storage/v1/object/sign/chat-files/options/req-1/brief.pdf?token=abc';
    const result = await resolveOptionDocumentUrl(makeDoc(legacyUrl));
    expect(result).toBe(legacyUrl);
    expect(storage.from).not.toHaveBeenCalled();
  });

  it('returns null when signed URL creation fails', async () => {
    storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: null, error: { message: 'expired' } }),
    });
    const result = await resolveOptionDocumentUrl(makeDoc('options/req-1/brief.pdf'));
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null on exception', async () => {
    storage.from.mockImplementation(() => { throw new Error('storage unavailable'); });
    const result = await resolveOptionDocumentUrl(makeDoc('options/req-1/brief.pdf'));
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── VULN-M4: writeAdminLog error handling ───────────────────────────────────

describe('writeAdminLog — VULN-M4 error handling', () => {
  it('logs error when insert fails (audit trail gap alert)', async () => {
    from.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: { message: 'rls' } }) });
    await writeAdminLog('test_action', 'user-42', { reason: 'test' });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('writeAdminLog'),
      expect.objectContaining({ action: 'test_action' }),
    );
  });

  it('does not throw on exception (silently logs)', async () => {
    from.mockImplementation(() => { throw new Error('connection reset'); });
    await expect(writeAdminLog('critical_action')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('exception'),
      expect.objectContaining({ action: 'critical_action' }),
    );
  });

  it('returns without error when user is not logged in', async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({ data: { user: null } });
    await expect(writeAdminLog('no_user_action')).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});

// ─── VULN-M5: getGuestLinksForAgency / deactivateGuestLink ──────────────────

describe('getGuestLinksForAgency — VULN-M5 exception safety', () => {
  it('returns empty array on DB error', async () => {
    from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }),
          }),
        }),
      }),
    });
    expect(await getGuestLinksForAgency('agency-1')).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns empty array on exception', async () => {
    from.mockImplementation(() => { throw new Error('network'); });
    expect(await getGuestLinksForAgency('agency-1')).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('exception'), expect.any(Error));
  });
});

describe('deactivateGuestLink — VULN-M5 exception safety', () => {
  it('returns false on DB error', async () => {
    from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: { message: 'rls' } }),
      }),
    });
    expect(await deactivateGuestLink('link-1')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns false on exception', async () => {
    from.mockImplementation(() => { throw new Error('network'); });
    expect(await deactivateGuestLink('link-1')).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('exception'), expect.any(Error));
  });
});

// ─── PERF-M7: getAgencyRevenue uses RPC, not JS reduce ───────────────────────

describe('getAgencyRevenue — PERF-M7 DB aggregation', () => {
  it('calls the get_agency_revenue RPC (not from())', async () => {
    rpc.mockResolvedValue({
      data: { total_fees: 15000, total_commission: 3000, booking_count: 5 },
      error: null,
    });
    const result = await getAgencyRevenue('agency-1');
    expect(rpc).toHaveBeenCalledWith('get_agency_revenue', { p_agency_id: 'agency-1' });
    expect(from).not.toHaveBeenCalled();
    expect(result.total_fees).toBe(15000);
    expect(result.total_commission).toBe(3000);
    expect(result.booking_count).toBe(5);
  });

  it('returns zeros on RPC error (fail-safe)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ total_fees: 0, total_commission: 0, booking_count: 0 });
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns zeros on exception', async () => {
    rpc.mockImplementation(() => { throw new Error('network'); });
    const result = await getAgencyRevenue('agency-1');
    expect(result).toEqual({ total_fees: 0, total_commission: 0, booking_count: 0 });
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── PERF-M2: getBookingsForAgency uses .range() ─────────────────────────────

describe('getBookingsForAgency — PERF-M2 pagination', () => {
  const buildChain = (resolvedValue: unknown) => {
    const rangeChain = { range: jest.fn().mockResolvedValue(resolvedValue) };
    const orderChain = { order: jest.fn().mockReturnValue(rangeChain) };
    const eqChain    = { eq:    jest.fn().mockReturnValue(orderChain) };
    return { select: jest.fn().mockReturnValue(eqChain) };
  };

  it('applies default range (0–199) when no opts provided', async () => {
    const mock = buildChain({ data: [], error: null });
    from.mockReturnValue(mock);
    await getBookingsForAgency('agency-1');
    expect(mock.select().eq().order().range).toHaveBeenCalledWith(0, 199);
  });

  it('applies custom range from opts', async () => {
    const mock = buildChain({ data: [], error: null });
    from.mockReturnValue(mock);
    await getBookingsForAgency('agency-1', { limit: 50, offset: 100 });
    expect(mock.select().eq().order().range).toHaveBeenCalledWith(100, 149);
  });

  it('returns empty array on DB error', async () => {
    from.mockReturnValue(buildChain({ data: null, error: { message: 'error' } }));
    expect(await getBookingsForAgency('agency-1')).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });
});
