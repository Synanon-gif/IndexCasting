/**
 * Tests for agencyStorageSupabase.ts
 *
 * All Supabase calls are mocked. Tests cover:
 * 1. Upload within limit → allowed: true
 * 2. Upload exceeding limit → allowed: false, upload blocked
 * 3. Delete file → storage decremented
 * 4. Concurrent uploads → used_bytes consistent (mocked sequential order)
 * 5. RLS enforcement: non-agency user → null from getMyAgencyStorageUsage
 * 6. Chat thread delete → storage.remove called + decrement called
 * 7. used_bytes never goes negative (decrement floor 0)
 */

import {
  getMyAgencyStorageUsage,
  checkAndIncrementStorage,
  decrementStorage,
  deleteChatThreadWithFiles,
  deleteModelPortfolioFiles,
  formatStorageBytes,
  getStorageUsagePercent,
  AGENCY_STORAGE_LIMIT_BYTES,
} from '../agencyStorageSupabase';

const rpcMock = jest.fn();
const storageMock = {
  from: jest.fn(),
};
const removeMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    storage: {
      from: (...args: unknown[]) => storageMock.from(...args),
    },
  },
}));

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  jest.clearAllMocks();
  storageMock.from.mockReturnValue({ remove: removeMock });
  removeMock.mockResolvedValue({ error: null });
});

// ─── 1. Upload within limit ────────────────────────────────────────────────────

describe('checkAndIncrementStorage', () => {
  it('returns allowed:true when used_bytes + file_size ≤ limit', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        allowed: true,
        used_bytes: 1_000_000,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
      },
      error: null,
    });

    const result = await checkAndIncrementStorage(500_000);

    expect(rpcMock).toHaveBeenCalledWith('increment_agency_storage_usage', { p_bytes: 500_000 });
    expect(result.allowed).toBe(true);
    expect(result.used_bytes).toBe(1_000_000);
  });

  // ─── 2. Upload exceeding limit ───────────────────────────────────────────────

  it('returns allowed:false when limit would be exceeded', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        allowed: false,
        used_bytes: AGENCY_STORAGE_LIMIT_BYTES - 100,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
      },
      error: null,
    });

    const result = await checkAndIncrementStorage(500_000);

    expect(result.allowed).toBe(false);
    expect(result.used_bytes).toBeGreaterThan(0);
  });

  it('returns allowed:false on RPC error (fail closed)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('network failure') });

    const result = await checkAndIncrementStorage(1_000);

    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ─── 4. Concurrent uploads (mocked sequential) ───────────────────────────────

  it('calls RPC for each concurrent upload independently', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { allowed: true, used_bytes: 100, limit_bytes: AGENCY_STORAGE_LIMIT_BYTES },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: true, used_bytes: 200, limit_bytes: AGENCY_STORAGE_LIMIT_BYTES },
        error: null,
      });

    const [r1, r2] = await Promise.all([
      checkAndIncrementStorage(100),
      checkAndIncrementStorage(100),
    ]);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});

// ─── 3. Delete file → storage decremented ─────────────────────────────────────

describe('decrementStorage', () => {
  it('calls decrement RPC with correct bytes', async () => {
    rpcMock.mockResolvedValueOnce({ data: 4_000_000, error: null });

    await decrementStorage(1_000_000);

    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', { p_bytes: 1_000_000 });
  });

  // ─── 7. used_bytes never goes negative ───────────────────────────────────────

  it('does not call RPC when fileSize is 0', async () => {
    await decrementStorage(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('does not call RPC when fileSize is negative', async () => {
    await decrementStorage(-500);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ─── 5. RLS enforcement: non-agency user → null ───────────────────────────────

describe('getMyAgencyStorageUsage', () => {
  it('returns null when RPC returns error field (non-agency user)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { error: 'No agency organization found for current user' },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('connection refused') });

    const result = await getMyAgencyStorageUsage();
    expect(result).toBeNull();
  });

  it('returns usage data for agency member', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_ID,
        used_bytes: 2_000_000_000,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();
    expect(result).not.toBeNull();
    expect(result?.organization_id).toBe(ORG_ID);
    expect(result?.used_bytes).toBe(2_000_000_000);
  });
});

// ─── 6. Chat thread delete → files removed + storage decremented ──────────────

describe('deleteChatThreadWithFiles', () => {
  const CONV_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('calls storage.remove and decrementStorage for each file', async () => {
    // RPC returns two files
    rpcMock
      .mockResolvedValueOnce({
        data: [
          { file_url: 'chat/conv/file1.jpg', path: 'chat/conv/file1.jpg', size_bytes: 200_000 },
          { file_url: 'chat/conv/file2.png', path: 'chat/conv/file2.png', size_bytes: 300_000 },
        ],
        error: null,
      })
      // decrementStorage call
      .mockResolvedValueOnce({ data: 0, error: null });

    const result = await deleteChatThreadWithFiles(CONV_ID);

    expect(rpcMock).toHaveBeenCalledWith('get_chat_thread_file_paths', {
      p_conversation_id: CONV_ID,
    });
    expect(storageMock.from).toHaveBeenCalledWith('chat-files');
    expect(removeMock).toHaveBeenCalledWith(['chat/conv/file1.jpg', 'chat/conv/file2.png']);
    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', { p_bytes: 500_000 });
    expect(result.deletedCount).toBe(2);
    expect(result.freedBytes).toBe(500_000);
  });

  it('returns zero counts when conversation has no files', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const result = await deleteChatThreadWithFiles(CONV_ID);

    expect(result.deletedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(storageMock.from).not.toHaveBeenCalled();
  });

  it('returns zero counts on RPC error', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error('unauthorized') });

    const result = await deleteChatThreadWithFiles(CONV_ID);

    expect(result.deletedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
  });
});

// ─── Model portfolio delete ───────────────────────────────────────────────────

describe('deleteModelPortfolioFiles', () => {
  const MODEL_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  it('calls storage.remove per bucket and decrementStorage', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: [
          {
            photo_id: 'p1',
            url: 'https://x.supabase.co/storage/v1/object/public/documentspictures/model-photos/m1/img1.jpg',
            bucket: 'documentspictures',
            path: 'model-photos/m1/img1.jpg',
            size_bytes: 1_000_000,
          },
          {
            photo_id: 'p2',
            url: 'supabase-private://documents/model-private-photos/m1/img2.jpg',
            bucket: 'documents',
            path: 'model-private-photos/m1/img2.jpg',
            size_bytes: 500_000,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null }); // decrement

    const result = await deleteModelPortfolioFiles(MODEL_ID);

    expect(rpcMock).toHaveBeenCalledWith('get_model_portfolio_file_paths', {
      p_model_id: MODEL_ID,
    });
    expect(storageMock.from).toHaveBeenCalledWith('documentspictures');
    expect(storageMock.from).toHaveBeenCalledWith('documents');
    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', { p_bytes: 1_500_000 });
    expect(result.deletedCount).toBe(2);
    expect(result.freedBytes).toBe(1_500_000);
  });
});

// ─── Security Hardening: Authorization bypass blocked ─────────────────────────

describe('deleteChatThreadWithFiles — authorization', () => {
  const CONV_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  it('returns zero counts when RPC raises unauthorized (wrong agency)', async () => {
    // Simulate the RPC throwing because conversation does not belong to caller's org.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: new Error(
        'get_chat_thread_file_paths: conversation does not belong to your organization',
      ),
    });

    const result = await deleteChatThreadWithFiles(CONV_ID);

    expect(result.deletedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(storageMock.from).not.toHaveBeenCalled();
  });
});

describe('deleteModelPortfolioFiles — authorization', () => {
  const MODEL_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  it('returns zero counts when RPC raises unauthorized (wrong agency)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: new Error(
        'get_model_portfolio_file_paths: model does not belong to your organization',
      ),
    });

    const result = await deleteModelPortfolioFiles(MODEL_ID);

    expect(result.deletedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(storageMock.from).not.toHaveBeenCalled();
  });
});

// ─── Security Hardening: Size reconciliation ──────────────────────────────────
// The reconciliation logic lives in modelPhotosSupabase.ts (getActualStorageSize).
// Here we verify the agencyStorageSupabase helpers behave correctly when called
// with the drift values produced by that reconciliation step.

describe('checkAndIncrementStorage — size drift reconciliation', () => {
  it('correctly increments the drift when actual > claimed', async () => {
    // Simulate: claimed 500 KB, actual (from storage.objects) is 600 KB → drift +100 KB
    rpcMock.mockResolvedValueOnce({
      data: { allowed: true, used_bytes: 600_000, limit_bytes: AGENCY_STORAGE_LIMIT_BYTES },
      error: null,
    });

    const result = await checkAndIncrementStorage(100_000); // drift = 100 KB

    expect(rpcMock).toHaveBeenCalledWith('increment_agency_storage_usage', { p_bytes: 100_000 });
    expect(result.allowed).toBe(true);
  });

  it('correctly decrements the drift when actual < claimed', async () => {
    // Simulate: claimed 500 KB, actual is 400 KB → drift -100 KB → decrement 100 KB
    rpcMock.mockResolvedValueOnce({ data: 400_000, error: null });

    await decrementStorage(100_000); // drift = -100 KB

    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', { p_bytes: 100_000 });
  });
});

// ─── Security Hardening: Large decrement audit log ────────────────────────────
// The >100 MB audit log is inserted in the DB (inside the SECURITY DEFINER RPC).
// Here we verify that the frontend still calls the RPC and does not silently drop it.

describe('decrementStorage — large single call still executes', () => {
  it('calls decrement RPC even for very large values (audit handled in DB)', async () => {
    rpcMock.mockResolvedValueOnce({ data: 0, error: null });

    await decrementStorage(500_000_000); // 500 MB — triggers DB audit log

    expect(rpcMock).toHaveBeenCalledWith('decrement_agency_storage_usage', {
      p_bytes: 500_000_000,
    });
  });
});

// ─── Helper: formatStorageBytes ───────────────────────────────────────────────

describe('formatStorageBytes', () => {
  it('formats 0 bytes', () => expect(formatStorageBytes(0)).toBe('0 B'));
  it('formats bytes', () => expect(formatStorageBytes(512)).toBe('512 B'));
  it('formats KB', () => expect(formatStorageBytes(1536)).toBe('1.5 KB'));
  it('formats MB', () => expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5.0 MB'));
  it('formats 10 GB', () => expect(formatStorageBytes(AGENCY_STORAGE_LIMIT_BYTES)).toBe('10.0 GB'));
});

// ─── Helper: getStorageUsagePercent ───────────────────────────────────────────

describe('getStorageUsagePercent', () => {
  it('returns 0 when used is 0', () => expect(getStorageUsagePercent(0, 1000)).toBe(0));
  it('returns 50 at half capacity', () => expect(getStorageUsagePercent(500, 1000)).toBe(50));
  it('returns 100 at full capacity', () => expect(getStorageUsagePercent(1000, 1000)).toBe(100));
  it('caps at 100 when over limit', () => expect(getStorageUsagePercent(2000, 1000)).toBe(100));
  it('returns 0 when limit is 0', () => expect(getStorageUsagePercent(500, 0)).toBe(0));
});

// ─── Admin Storage Override ───────────────────────────────────────────────────
// Tests for the new per-org admin-controlled limit fields.

describe('getMyAgencyStorageUsage — is_unlimited flag', () => {
  it('returns is_unlimited:true and null effective_limit_bytes when org has unlimited storage', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_ID,
        used_bytes: 2_000_000_000,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
        effective_limit_bytes: null,
        is_unlimited: true,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(result).not.toBeNull();
    expect(result!.is_unlimited).toBe(true);
    expect(result!.effective_limit_bytes).toBeNull();
    expect(result!.used_bytes).toBe(2_000_000_000);
  });

  it('returns custom effective_limit_bytes when admin has set a custom limit', async () => {
    const customLimit = 20 * 1024 * 1024 * 1024; // 20 GB
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_ID,
        used_bytes: 5_000_000_000,
        limit_bytes: customLimit,
        effective_limit_bytes: customLimit,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(result).not.toBeNull();
    expect(result!.is_unlimited).toBe(false);
    expect(result!.effective_limit_bytes).toBe(customLimit);
    expect(result!.limit_bytes).toBe(customLimit);
  });
});

describe('checkAndIncrementStorage — unlimited org always allowed', () => {
  it('returns allowed:true when org is_unlimited even at 100% usage', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        allowed: true,
        used_bytes: AGENCY_STORAGE_LIMIT_BYTES + 1_000_000,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
        is_unlimited: true,
      },
      error: null,
    });

    const result = await checkAndIncrementStorage(1_000_000);

    expect(rpcMock).toHaveBeenCalledWith('increment_agency_storage_usage', { p_bytes: 1_000_000 });
    expect(result.allowed).toBe(true);
    expect(result.is_unlimited).toBe(true);
  });
});

describe('checkAndIncrementStorage — custom limit enforcement', () => {
  it('returns allowed:false when custom limit would be exceeded', async () => {
    const customLimit = 10 * 1024 * 1024 * 1024; // 10 GB
    rpcMock.mockResolvedValueOnce({
      data: {
        allowed: false,
        used_bytes: customLimit - 100,
        limit_bytes: customLimit,
        is_unlimited: false,
      },
      error: null,
    });

    const result = await checkAndIncrementStorage(500_000);

    expect(result.allowed).toBe(false);
    expect(result.limit_bytes).toBe(customLimit);
  });
});

describe('getMyAgencyStorageUsage — default plan fallback', () => {
  it('falls back to AGENCY_STORAGE_LIMIT_BYTES when no override columns are present', async () => {
    // Simulates a pre-migration RPC response with no new fields.
    rpcMock.mockResolvedValueOnce({
      data: {
        organization_id: ORG_ID,
        used_bytes: 1_000_000,
        limit_bytes: AGENCY_STORAGE_LIMIT_BYTES,
        // effective_limit_bytes and is_unlimited are absent (pre-migration).
      },
      error: null,
    });

    const result = await getMyAgencyStorageUsage();

    expect(result).not.toBeNull();
    expect(result!.is_unlimited).toBe(false);
    expect(result!.limit_bytes).toBe(AGENCY_STORAGE_LIMIT_BYTES);
    // effective_limit_bytes falls back to null (no override set).
    expect(result!.effective_limit_bytes).toBeNull();
  });
});
