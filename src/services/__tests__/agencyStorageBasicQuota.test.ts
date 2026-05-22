/**
 * Agency Basic storage quota — canonical 10 GB (product Apr 2026).
 * Guards against regression to legacy 5 GB in RPC fallbacks or UI constants.
 */
import {
  AGENCY_STORAGE_LIMIT_BYTES,
  formatStorageBytes,
  getStorageUsagePercent,
  getMyAgencyStorageUsage,
} from '../agencyStorageSupabase';
import { PLAN_LIMITS } from '../subscriptionSupabase';

const LEGACY_BASIC_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

const rpcMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe('agency Basic storage quota — 10 GB canonical', () => {
  it('AGENCY_STORAGE_LIMIT_BYTES equals 10 GB', () => {
    expect(AGENCY_STORAGE_LIMIT_BYTES).toBe(10 * 1024 * 1024 * 1024);
    expect(AGENCY_STORAGE_LIMIT_BYTES).not.toBe(LEGACY_BASIC_LIMIT_BYTES);
  });

  it('PLAN_LIMITS.agency_basic.storageGB is 10', () => {
    expect(PLAN_LIMITS.agency_basic.storageGB).toBe(10);
  });

  it('PLAN_LIMITS.trial.storageGB is 10 (same as Basic)', () => {
    expect(PLAN_LIMITS.trial.storageGB).toBe(10);
  });

  it('formats Basic limit as "10.0 GB"', () => {
    expect(formatStorageBytes(AGENCY_STORAGE_LIMIT_BYTES)).toBe('10.0 GB');
  });

  it('138 MB used at 10 GB limit is ~1% (not ~3% at legacy 5 GB)', () => {
    const usedBytes = 144_681_586; // production-shaped value → "138.0 MB" display
    const pctAt10Gb = getStorageUsagePercent(usedBytes, AGENCY_STORAGE_LIMIT_BYTES);
    const pctAt5Gb = getStorageUsagePercent(usedBytes, LEGACY_BASIC_LIMIT_BYTES);

    expect(formatStorageBytes(usedBytes)).toBe('138.0 MB');
    // Widget rounds with toFixed(0) — ~1% at 10 GB, ~3% at legacy 5 GB
    expect(Number(pctAt10Gb.toFixed(0))).toBe(1);
    expect(Number(pctAt5Gb.toFixed(0))).toBe(3);
    expect(pctAt10Gb).toBeLessThan(pctAt5Gb);
  });

  it('getMyAgencyStorageUsage maps agency_basic RPC limit to 10 GB', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: 'org-basic',
        used_bytes: 144_681_586,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
        effective_limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(result).not.toBeNull();
    expect(result!.limit_bytes).toBe(AGENCY_STORAGE_LIMIT_BYTES);
    expect(formatStorageBytes(result!.limit_bytes)).toBe('10.0 GB');
    expect(Number(getStorageUsagePercent(result!.used_bytes, result!.limit_bytes).toFixed(0))).toBe(
      1,
    );
  });

  it('Pro and Enterprise PLAN_LIMITS storageGB unchanged', () => {
    expect(PLAN_LIMITS.agency_pro.storageGB).toBe(100);
    expect(PLAN_LIMITS.agency_enterprise.storageGB).toBe(200);
  });
});
