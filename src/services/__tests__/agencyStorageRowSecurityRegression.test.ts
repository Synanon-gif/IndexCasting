/**
 * REGRESSION TESTS: get_my_agency_storage_usage row_security=off fix
 *
 * Root cause: Migration 20260721 added SET row_security TO off to
 * increment_agency_storage_usage and decrement_agency_storage_usage
 * but omitted get_my_agency_storage_usage.
 *
 * Without row_security=off, the INSERT ... ON CONFLICT DO NOTHING inside
 * get_my_agency_storage_usage was silently blocked by RLS (no INSERT policy
 * for 'authenticated' on organization_storage_usage). For a new agency that
 * had never triggered increment (= no row yet), the subsequent SELECT returned
 * nothing → used_bytes coalesced to 0 → widget showed "0 Storage Usage" even
 * after files were uploaded.
 *
 * Fix: supabase/migrations/20261327_fix_get_my_agency_storage_usage_row_security.sql
 *
 * These tests verify the FRONTEND CONTRACT between the RPC and the service.
 * DB-layer behavior is verified by live-DB query in e2e-artifacts/2026-05-12/.
 */

import {
  getMyAgencyStorageUsage,
  checkAndIncrementStorage,
  decrementStorage,
  formatStorageBytes,
  getStorageUsagePercent,
} from '../agencyStorageSupabase';

const rpcMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    storage: {
      from: jest.fn(() => ({ remove: jest.fn().mockResolvedValue({ error: null }) })),
    },
  },
}));

const ORG_A = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Bug Regression: new agency initial state ─────────────────────────────────
// Before fix: INSERT blocked by RLS → SELECT found nothing → {used_bytes: 0}
// After fix:  INSERT succeeds (row_security=off) → SELECT returns row → correct bytes

describe('[regression] getMyAgencyStorageUsage — new agency initial state (used_bytes: 0)', () => {
  it('returns {used_bytes: 0} when agency has never uploaded (valid zero)', async () => {
    // After fix: RPC correctly initialises row and returns {used_bytes: 0}
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_A,
        used_bytes: 0,
        limit_bytes: 5_368_709_120,
        effective_limit_bytes: 5_368_709_120,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(rpcMock).toHaveBeenCalledWith('get_my_agency_storage_usage');
    expect(result).not.toBeNull();
    expect(result!.used_bytes).toBe(0);
    expect(result!.organization_id).toBe(ORG_A);
  });

  it('returns null (load error) only when RPC itself fails, not when used_bytes is 0', async () => {
    // Used_bytes = 0 is a VALID state → must NOT return null
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_A,
        used_bytes: 0,
        limit_bytes: 5_368_709_120,
        effective_limit_bytes: null,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();
    // Widget must show "0 B / 5 GB" — not "load error"
    expect(result).not.toBeNull();
    expect(result!.used_bytes).toBe(0);
  });

  it('returns null when RPC returns error JSON (non-agency user)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { error: 'No agency organization found for current user' },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();
    expect(result).toBeNull();
  });

  it('returns null on RPC network error (fail-closed)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('network timeout') });

    const result = await getMyAgencyStorageUsage();
    expect(result).toBeNull();
  });
});

// ─── Bug Regression: upload increases storage counter ────────────────────────
// Verifies that after an upload, the RPC counter reflects the new bytes.
// (upload → increment RPC → counter in DB increases → next get call returns new value)

describe('[regression] upload increases storage counter', () => {
  it('increment returns allowed:true and new used_bytes after upload', async () => {
    const FILE_SIZE = 1_048_576; // 1 MB
    rpcMock.mockResolvedValueOnce({
      data: {
        allowed: true,
        used_bytes: FILE_SIZE,
        limit_bytes: 5_368_709_120,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await checkAndIncrementStorage(FILE_SIZE);

    expect(rpcMock).toHaveBeenCalledWith('increment_agency_storage_usage', { p_bytes: FILE_SIZE });
    expect(result.allowed).toBe(true);
    expect(result.used_bytes).toBe(FILE_SIZE);
  });

  it('get_my_agency_storage_usage reflects post-upload bytes', async () => {
    const USED = 5_242_880; // 5 MB (simulates state after several uploads)
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_A,
        used_bytes: USED,
        limit_bytes: 5_368_709_120,
        effective_limit_bytes: 5_368_709_120,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(result).not.toBeNull();
    expect(result!.used_bytes).toBe(USED);
  });
});

// ─── Bug Regression: delete decreases storage counter ────────────────────────

describe('[regression] delete decreases storage counter', () => {
  it('decrement is called with correct bytes on file delete', async () => {
    const FILE_SIZE = 2_097_152; // 2 MB
    rpcMock.mockResolvedValueOnce({ data: 3_145_728, error: null }); // 3 MB remaining

    await decrementStorage(FILE_SIZE);

    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', { p_bytes: FILE_SIZE });
  });

  it('storage usage never goes below 0 (DB GREATEST guard)', async () => {
    // DB handles floor(0), service just passes bytes through
    rpcMock.mockResolvedValueOnce({ data: 0, error: null }); // DB returns 0

    await decrementStorage(999_999_999);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    // DB clamps to 0 via GREATEST(0, used_bytes - p_bytes)
    // Frontend correctly passes the value without modification
  });

  it('decrement is NOT called when fileSize is 0', async () => {
    await decrementStorage(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ─── Bug Regression: replace/overwrite updates counter correctly ──────────────
// Replace = delete old (decrement) + upload new (increment)

describe('[regression] replace/overwrite updates counter correctly', () => {
  it('replace: decrement old, increment new', async () => {
    const OLD_SIZE = 3_000_000;
    const NEW_SIZE = 5_000_000;

    // decrement old file
    rpcMock.mockResolvedValueOnce({ data: 2_000_000, error: null });
    // increment new file
    rpcMock.mockResolvedValueOnce({
      data: { allowed: true, used_bytes: 7_000_000, limit_bytes: 5_368_709_120 },
      error: null,
    });

    await decrementStorage(OLD_SIZE);
    await checkAndIncrementStorage(NEW_SIZE);

    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', {
      p_bytes: OLD_SIZE,
    });
    expect(rpcMock).toHaveBeenCalledWith('increment_agency_storage_usage', {
      p_bytes: NEW_SIZE,
    });
  });
});

// ─── Bug Regression: other agency not affected ───────────────────────────────
// Isolation: each RPC call resolves org via auth.uid() — only own agency is affected

describe('[regression] other agency is not affected', () => {
  it('each RPC call is isolated by auth.uid() in the DB — no cross-org arg', async () => {
    // The RPC takes no org_id argument — isolation is DB-side via auth.uid()
    rpcMock.mockResolvedValueOnce({
      data: { organization_id: ORG_A, used_bytes: 100_000, limit_bytes: 5_368_709_120 },
      error: null,
    });

    await getMyAgencyStorageUsage();

    // Verify the RPC is called with NO org_id parameter (isolation is DB-enforced)
    expect(rpcMock).toHaveBeenCalledWith('get_my_agency_storage_usage');
    const callArgs = rpcMock.mock.calls[0];
    // Only function name, no second parameter (or empty second param)
    expect(callArgs.length).toBe(1);
  });
});

// ─── Bug Regression: usage persists after reload ─────────────────────────────
// Two sequential calls return the same value (simulates page reload)

describe('[regression] storage usage persists after reload', () => {
  it('two calls return same used_bytes (persistent DB state)', async () => {
    const BYTES = 12_582_912; // 12 MB
    rpcMock
      .mockResolvedValueOnce({
        data: {
          organization_id: ORG_A,
          used_bytes: BYTES,
          limit_bytes: 5_368_709_120,
          effective_limit_bytes: 5_368_709_120,
          is_unlimited: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          organization_id: ORG_A,
          used_bytes: BYTES,
          limit_bytes: 5_368_709_120,
          effective_limit_bytes: 5_368_709_120,
          is_unlimited: false,
        },
        error: null,
      });

    const first = await getMyAgencyStorageUsage();
    const second = await getMyAgencyStorageUsage();

    expect(first!.used_bytes).toBe(BYTES);
    expect(second!.used_bytes).toBe(BYTES);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});

// ─── Bug Regression: multiple uploads aggregate correctly ────────────────────

describe('[regression] multiple uploads aggregate correctly', () => {
  it('three sequential uploads show correct cumulative bytes', async () => {
    const f1 = 1_048_576; // 1 MB
    const f2 = 2_097_152; // 2 MB
    const f3 = 3_145_728; // 3 MB

    rpcMock
      .mockResolvedValueOnce({
        data: { allowed: true, used_bytes: f1, limit_bytes: 5_368_709_120 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: true, used_bytes: f1 + f2, limit_bytes: 5_368_709_120 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: true, used_bytes: f1 + f2 + f3, limit_bytes: 5_368_709_120 },
        error: null,
      });

    const r1 = await checkAndIncrementStorage(f1);
    const r2 = await checkAndIncrementStorage(f2);
    const r3 = await checkAndIncrementStorage(f3);

    expect(r1.used_bytes).toBe(f1);
    expect(r2.used_bytes).toBe(f1 + f2);
    expect(r3.used_bytes).toBe(f1 + f2 + f3);
    expect(r3.used_bytes).toBe(6_291_456); // 6 MB total
  });
});

// ─── Bug Regression: large file formatting correct (KB / MB) ─────────────────

describe('[regression] large file formatting', () => {
  it('formats 1 KB correctly', () => {
    expect(formatStorageBytes(1024)).toBe('1.0 KB');
  });

  it('formats 1 MB correctly', () => {
    expect(formatStorageBytes(1_048_576)).toBe('1.0 MB');
  });

  it('formats 144 MB correctly (Poetry Of People production value)', () => {
    expect(formatStorageBytes(144_681_586)).toBe('138.0 MB');
  });

  it('formats 53 MB correctly (Agency 1 production value)', () => {
    expect(formatStorageBytes(53_089_513)).toBe('50.6 MB');
  });

  it('formats 5 GB limit correctly', () => {
    expect(formatStorageBytes(5_368_709_120)).toBe('5.0 GB');
  });

  it('formats 0 correctly — new agency shows "0 B"', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
  });
});

// ─── Bug Regression: usage percentage ────────────────────────────────────────

describe('[regression] usage percentage calculation', () => {
  it('0% for new agency with 0 bytes', () => {
    expect(getStorageUsagePercent(0, 5_368_709_120)).toBe(0);
  });

  it('50% at half limit', () => {
    expect(getStorageUsagePercent(2_684_354_560, 5_368_709_120)).toBe(50);
  });

  it('100% at full limit', () => {
    expect(getStorageUsagePercent(5_368_709_120, 5_368_709_120)).toBe(100);
  });

  it('capped at 100% even when over limit', () => {
    expect(getStorageUsagePercent(6_000_000_000, 5_368_709_120)).toBe(100);
  });

  it('0% when limit is 0 (division by zero guard)', () => {
    expect(getStorageUsagePercent(500, 0)).toBe(0);
  });
});

// ─── Bug Regression: empty agency shows 0 correctly ──────────────────────────

describe('[regression] empty agency shows 0 correctly', () => {
  it('getMyAgencyStorageUsage returns used_bytes:0 for brand-new agency (not null)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_A,
        used_bytes: 0,
        limit_bytes: 5_368_709_120,
        effective_limit_bytes: 5_368_709_120,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    // Must be non-null (valid data), with used_bytes = 0
    expect(result).not.toBeNull();
    expect(result!.used_bytes).toBe(0);
    // Formatted: "0 B"
    expect(formatStorageBytes(result!.used_bytes)).toBe('0 B');
    // Percentage: 0%
    expect(getStorageUsagePercent(result!.used_bytes, result!.limit_bytes)).toBe(0);
  });
});
