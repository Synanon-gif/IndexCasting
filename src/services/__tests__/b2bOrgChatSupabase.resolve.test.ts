import { resolveB2bChatOrganizationIds, resolveB2bOrgPairForChat } from '../b2bOrgChatSupabase';

const rpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe('resolveB2bChatOrganizationIds', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns org ids on success', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        client_org_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        agency_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      },
      error: null,
    });
    const r = await resolveB2bChatOrganizationIds('user-1', 'agency-uuid');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.client_org_id).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
      expect(r.agency_org_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    }
  });

  it('returns error when RPC returns ok: false', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, error: 'agency_org_missing' },
      error: null,
    });
    const r = await resolveB2bChatOrganizationIds('user-1', 'agency-uuid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('agency_org_missing');
  });
});

describe('resolveB2bOrgPairForChat', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns org ids on success', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        client_org_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        agency_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      },
      error: null,
    });
    const r = await resolveB2bOrgPairForChat('agency-uuid', 'client-org-uuid');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.client_org_id).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
      expect(r.agency_org_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    }
  });

  it('returns migration_required when RPC is missing', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const r = await resolveB2bOrgPairForChat('agency-uuid', 'client-org-uuid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('migration_required');
  });
});
