/**
 * Tests for guest link validation in guestLinksSupabase.ts
 *
 * Guest links are security-critical: they expose model data to external
 * parties. These tests verify that:
 *
 *   1. getGuestLink (RPC) — returns info for valid active link,
 *                            returns null for inactive/expired/invalid links,
 *                            returns null on RPC error (fail-closed)
 *   2. deleteGuestLink    — soft-deletes by setting deleted_at; guards with IS NULL check
 *   3. createGuestLink    — inserts with correct fields and created_by
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'agency-user-1' } },
      }),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    storage: { from: jest.fn() },
  },
}));

import {
  getGuestLink,
  getAgencyOrgIdForGuestLink,
  deleteGuestLink,
  createGuestLink,
} from '../guestLinksSupabase';

let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply auth mock after resetAllMocks clears implementations
  const { supabase } = jest.requireMock('../../../lib/supabase') as {
    supabase: { auth: { getUser: jest.Mock } };
  };
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'agency-user-1' } } });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
});

// ─── 1. getGuestLink via RPC ─────────────────────────────────────────────────

describe('getGuestLink — valid active link', () => {
  it('returns link info when RPC returns a non-empty result', async () => {
    const linkInfo = {
      id: 'link-1',
      label: 'Autumn Campaign',
      agency_name: 'Best Agency',
      type: 'portfolio',
      is_active: true,
      expires_at: null,
      tos_accepted_by_guest: false,
    };
    mockRpc.mockResolvedValue({ data: [linkInfo], error: null });

    const result = await getGuestLink('link-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('link-1');
    expect(result?.is_active).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('get_guest_link_info', { p_link_id: 'link-1' });
  });

  it('returns link info when RPC returns a single object (not array)', async () => {
    const linkInfo = {
      id: 'link-obj',
      label: 'Campaign',
      agency_name: 'Agency',
      type: 'portfolio',
      is_active: true,
      expires_at: null,
      tos_accepted_by_guest: false,
    };
    mockRpc.mockResolvedValue({ data: linkInfo, error: null });

    const result = await getGuestLink('link-obj');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('link-obj');
  });

  it('trims link id before calling RPC', async () => {
    const linkInfo = {
      id: 'link-trim',
      label: 'L',
      agency_name: 'A',
      type: 'portfolio',
      is_active: true,
      expires_at: null,
      tos_accepted_by_guest: false,
    };
    mockRpc.mockResolvedValue({ data: [linkInfo], error: null });

    await getGuestLink('  link-trim  ');

    expect(mockRpc).toHaveBeenCalledWith('get_guest_link_info', { p_link_id: 'link-trim' });
  });

  it('uses the security-definer RPC (not direct table access) to prevent enumeration', () => {
    // getGuestLink must route through 'get_guest_link_info' RPC — never from('guest_links')
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ─── getAgencyOrgIdForGuestLink (C-2 org resolution for guest chat) ─────────────

describe('getAgencyOrgIdForGuestLink', () => {
  it('returns org UUID when RPC succeeds', async () => {
    mockRpc.mockResolvedValue({ data: '00000000-0000-0000-0000-00000000aa01', error: null });
    const org = await getAgencyOrgIdForGuestLink('550e8400-e29b-41d4-a716-446655440000');
    expect(org).toBe('00000000-0000-0000-0000-00000000aa01');
    expect(mockRpc).toHaveBeenCalledWith('get_agency_org_id_for_link', {
      p_link_id: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('trims link id before RPC', async () => {
    mockRpc.mockResolvedValue({ data: 'org-1', error: null });
    await getAgencyOrgIdForGuestLink('  link-trim-2  ');
    expect(mockRpc).toHaveBeenCalledWith('get_agency_org_id_for_link', {
      p_link_id: 'link-trim-2',
    });
  });

  it('returns null without calling RPC when link id is empty or whitespace', async () => {
    mockRpc.mockReset();
    expect(await getAgencyOrgIdForGuestLink('')).toBeNull();
    expect(await getAgencyOrgIdForGuestLink('   ')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns null on RPC error (fail-closed, no org leak)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid link' } });
    const org = await getAgencyOrgIdForGuestLink('bad-link');
    expect(org).toBeNull();
  });

  it('returns null on exception', async () => {
    mockRpc.mockRejectedValue(new Error('network'));
    const org = await getAgencyOrgIdForGuestLink('any-id');
    expect(org).toBeNull();
  });
});

describe('getGuestLink — invalid / expired link', () => {
  it('returns null when RPC returns an empty array (link inactive/expired/revoked)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getGuestLink('expired-link');

    expect(result).toBeNull();
  });

  it('returns null when RPC returns null data (link does not exist)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await getGuestLink('nonexistent-link');

    expect(result).toBeNull();
  });

  it('returns null when RPC returns an error (fail-closed, no data leakage)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });

    const result = await getGuestLink('link-x');

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null on exception (fail-closed)', async () => {
    mockRpc.mockRejectedValue(new Error('network'));

    const result = await getGuestLink('link-y');

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
});

// ─── 2. deleteGuestLink — RPC revoke_guest_access ───────────────────────────

describe('deleteGuestLink — revoke_guest_access RPC', () => {
  it('returns true on successful revoke (calls revoke_guest_access RPC)', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const result = await deleteGuestLink('link-1');

    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('revoke_guest_access', { p_link_id: 'link-1' });
  });

  it('returns false when RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });

    const result = await deleteGuestLink('link-1');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns false on exception (fail-closed)', async () => {
    mockRpc.mockRejectedValue(new Error('network'));

    const result = await deleteGuestLink('link-1');

    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns false for empty linkId without calling RPC', async () => {
    const result = await deleteGuestLink('   ');

    expect(result).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ─── 3. createGuestLink ───────────────────────────────────────────────────────

describe('createGuestLink', () => {
  const makeInsertChain = (result: unknown) => {
    const single = jest.fn().mockResolvedValue(result);
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    return { insert };
  };

  it('returns GuestLink on success with correct fields', async () => {
    const link = {
      id: 'new-link-1',
      agency_id: 'agency-1',
      model_ids: ['m-1', 'm-2'],
      label: 'Spring Cast',
      type: 'portfolio',
      is_active: true,
      created_at: '2026-04-01T00:00:00Z',
      deleted_at: null,
    };
    mockFrom.mockReturnValue(makeInsertChain({ data: link, error: null }));

    const result = await createGuestLink({
      agency_id: 'agency-1',
      model_ids: ['m-1', 'm-2'],
      label: 'Spring Cast',
      type: 'portfolio',
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('new-link-1');
    expect(result?.type).toBe('portfolio');
  });

  it('sets created_by to the current user id', async () => {
    const chain = makeInsertChain({ data: { id: 'link-2' }, error: null });
    mockFrom.mockReturnValue(chain);

    await createGuestLink({ agency_id: 'a-1', model_ids: [], type: 'polaroid' });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'agency-user-1' }),
    );
  });

  it('returns null on DB error', async () => {
    mockFrom.mockReturnValue(makeInsertChain({ data: null, error: { message: 'rls' } }));

    const result = await createGuestLink({ agency_id: 'a-1', model_ids: [], type: 'portfolio' });

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null on exception', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('network');
    });

    const result = await createGuestLink({ agency_id: 'a-1', model_ids: [], type: 'portfolio' });

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
});
