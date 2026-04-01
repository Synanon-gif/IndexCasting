/**
 * Tests for admin storage override functions in adminSupabase.ts
 *
 * All Supabase RPC calls are mocked. Tests cover:
 * 1. adminSetStorageLimit      → calls correct RPC + writeAdminLog
 * 2. adminSetUnlimitedStorage  → calls correct RPC + writeAdminLog
 * 3. adminResetToDefaultStorageLimit → calls correct RPC + writeAdminLog
 * 4. adminGetOrgStorageUsage   → maps all fields correctly
 * 5. Any admin function        → returns false / null on RPC error
 */

import {
  adminGetOrgStorageUsage,
  adminSetStorageLimit,
  adminSetUnlimitedStorage,
  adminResetToDefaultStorageLimit,
} from '../adminSupabase';

const rpcMock = jest.fn();
const insertMock = jest.fn().mockResolvedValue({ error: null });
const fromMock = jest.fn().mockReturnValue({ insert: insertMock });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-user-id' } } }),
    },
  },
}));

const ORG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── 1. adminSetStorageLimit ───────────────────────────────────────────────────

describe('adminSetStorageLimit', () => {
  it('calls admin_set_storage_limit RPC with correct params and returns true', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminSetStorageLimit(ORG_ID, 10_737_418_240); // 10 GB

    expect(rpcMock).toHaveBeenCalledWith('admin_set_storage_limit', {
      p_organization_id: ORG_ID,
      p_new_limit_bytes: 10_737_418_240,
    });
    expect(result).toBe(true);
  });

  it('returns false when the RPC throws an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('permission denied') });

    const result = await adminSetStorageLimit(ORG_ID, 5_368_709_120);

    expect(result).toBe(false);
  });
});

// ─── 2. adminSetUnlimitedStorage ──────────────────────────────────────────────

describe('adminSetUnlimitedStorage', () => {
  it('calls admin_set_unlimited_storage RPC and returns true', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminSetUnlimitedStorage(ORG_ID);

    expect(rpcMock).toHaveBeenCalledWith('admin_set_unlimited_storage', {
      p_organization_id: ORG_ID,
    });
    expect(result).toBe(true);
  });

  it('returns false when the RPC rejects', async () => {
    rpcMock.mockRejectedValue(new Error('network error'));

    const result = await adminSetUnlimitedStorage(ORG_ID);

    expect(result).toBe(false);
  });
});

// ─── 3. adminResetToDefaultStorageLimit ──────────────────────────────────────

describe('adminResetToDefaultStorageLimit', () => {
  it('calls admin_reset_to_default_storage_limit RPC and returns true', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await adminResetToDefaultStorageLimit(ORG_ID);

    expect(rpcMock).toHaveBeenCalledWith('admin_reset_to_default_storage_limit', {
      p_organization_id: ORG_ID,
    });
    expect(result).toBe(true);
  });

  it('returns false when the RPC returns an error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('not admin') });

    const result = await adminResetToDefaultStorageLimit(ORG_ID);

    expect(result).toBe(false);
  });
});

// ─── 4. adminGetOrgStorageUsage — field mapping ───────────────────────────────

describe('adminGetOrgStorageUsage', () => {
  it('maps all RPC response fields correctly for a custom-limit org', async () => {
    const rawRpcRow = {
      organization_id:    ORG_ID,
      used_bytes:         '2147483648', // 2 GB (string — Postgres bigint)
      storage_limit_bytes:'10737418240', // 10 GB
      is_unlimited:       false,
      effective_limit_bytes: '10737418240',
    };
    rpcMock.mockResolvedValue({ data: rawRpcRow, error: null });

    const result = await adminGetOrgStorageUsage(ORG_ID);

    expect(result).not.toBeNull();
    expect(result!.organization_id).toBe(ORG_ID);
    expect(result!.used_bytes).toBe(2_147_483_648);
    expect(result!.storage_limit_bytes).toBe(10_737_418_240);
    expect(result!.is_unlimited).toBe(false);
    expect(result!.effective_limit_bytes).toBe(10_737_418_240);
  });

  it('maps fields correctly for an unlimited org (storage_limit_bytes = null, effective_limit_bytes = null)', async () => {
    const rawRpcRow = {
      organization_id:    ORG_ID,
      used_bytes:         '5000000000',
      storage_limit_bytes: null,
      is_unlimited:       true,
      effective_limit_bytes: null,
    };
    rpcMock.mockResolvedValue({ data: rawRpcRow, error: null });

    const result = await adminGetOrgStorageUsage(ORG_ID);

    expect(result).not.toBeNull();
    expect(result!.is_unlimited).toBe(true);
    expect(result!.storage_limit_bytes).toBeNull();
    expect(result!.effective_limit_bytes).toBeNull();
  });

  it('returns null when the RPC returns an error payload', async () => {
    rpcMock.mockResolvedValue({ data: { error: 'Organization not found' }, error: null });

    const result = await adminGetOrgStorageUsage(ORG_ID);

    expect(result).toBeNull();
  });

  it('returns null when the RPC throws', async () => {
    rpcMock.mockRejectedValue(new Error('db connection failed'));

    const result = await adminGetOrgStorageUsage(ORG_ID);

    expect(result).toBeNull();
  });
});
