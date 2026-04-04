/**
 * Tests for removeOrganizationMember in organizationsInvitationsSupabase.ts
 *
 * EXPLOIT-H1 fix: Member removal must call the member-remove Edge Function
 * which server-side revokes the target user's session immediately.
 *
 * Tests verify:
 *   1. Successful removal invokes the Edge Function with correct arguments
 *   2. Returns ok:false when the function itself returns an error body
 *   3. Returns ok:false when functions.invoke() throws a network error
 *   4. Returns ok:false when the Edge Function returns ok:false with error detail
 *   5. Owner-only: Edge Function rejects non-owner callers (propagated as ok:false)
 */

const mockInvoke = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc:  jest.fn(),
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'owner-1' } } }),
    },
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import { removeOrganizationMember } from '../organizationsInvitationsSupabase';

let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

// ─── 1. Successful removal ────────────────────────────────────────────────────

describe('removeOrganizationMember — success (EXPLOIT-H1 fix)', () => {
  it('calls member-remove Edge Function with targetUserId and organizationId', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await removeOrganizationMember('target-user-1', 'org-1');

    expect(result.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('member-remove', {
      body: { targetUserId: 'target-user-1', organizationId: 'org-1' },
    });
  });

  it('returns ok:true regardless of extra fields in success response', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, revoked_sessions: 2 },
      error: null,
    });

    expect((await removeOrganizationMember('u1', 'org-1')).ok).toBe(true);
  });
});

// ─── 2. Edge Function invoke error ───────────────────────────────────────────

describe('removeOrganizationMember — invoke error', () => {
  it('returns ok:false when functions.invoke returns an error', async () => {
    mockInvoke.mockResolvedValue({
      data:  null,
      error: { message: 'Function failed' },
    });

    const result = await removeOrganizationMember('u1', 'org-1');

    expect(result.ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 3. Network / exception failure ──────────────────────────────────────────

describe('removeOrganizationMember — exception', () => {
  it('returns ok:false on thrown exception (fail-closed)', async () => {
    mockInvoke.mockRejectedValue(new Error('connection reset'));

    const result = await removeOrganizationMember('u1', 'org-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 4. Edge Function returns ok:false ────────────────────────────────────────

describe('removeOrganizationMember — function body error', () => {
  it('returns ok:false when function body contains ok:false', async () => {
    mockInvoke.mockResolvedValue({
      data:  { ok: false, error: 'not_authorized' },
      error: null,
    });

    const result = await removeOrganizationMember('u1', 'org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not_authorized');
    expect(errSpy).toHaveBeenCalled();
  });

  it('surfaces "Failed to remove member" when function body has no error string', async () => {
    mockInvoke.mockResolvedValue({
      data:  { ok: false },
      error: null,
    });

    const result = await removeOrganizationMember('u1', 'org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to remove member/i);
  });
});

// ─── 5. Owner-only enforcement (simulated via function rejection) ─────────────

describe('removeOrganizationMember — owner-only (EXPLOIT-H1)', () => {
  it('returns ok:false when Edge Function rejects non-owner attempt', async () => {
    mockInvoke.mockResolvedValue({
      data:  { ok: false, error: 'only_owner_can_remove_members' },
      error: null,
    });

    const result = await removeOrganizationMember('u1', 'org-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('only_owner_can_remove_members');
  });
});
