import { uiCopy } from '../../constants/uiCopy';
import { ensureAgencyModelDirectChat } from '../b2bOrgChatSupabase';

const rpc = jest.fn();
const getUser = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: () => getUser() },
  },
}));

const baseParams = {
  agencyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  agencyOrganizationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  modelId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  modelUserId: null as string | null,
  actingUserId: 'user-acting-1',
  modelName: 'Test Model',
  agencyName: 'Test Agency',
};

describe('ensureAgencyModelDirectChat', () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: 'user-acting-1' } }, error: null });
  });

  it('returns conversation id on RPC success', async () => {
    rpc.mockResolvedValue({
      data: '11111111-1111-1111-1111-111111111111',
      error: null,
    });
    const r = await ensureAgencyModelDirectChat(baseParams);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.conversationId).toBe('11111111-1111-1111-1111-111111111111');
      expect(r.created).toBe(false);
    }
    expect(rpc).toHaveBeenCalledWith('ensure_agency_model_direct_conversation', {
      p_agency_id: baseParams.agencyId,
      p_model_id: baseParams.modelId,
    });
  });

  it('maps no_active_representation to roster copy', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'no_active_representation', code: 'P0001' },
    });
    const r = await ensureAgencyModelDirectChat(baseParams);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(uiCopy.messages.modelDirectChatNoRepresentation);
    }
  });

  it('fails when acting user does not match session', async () => {
    const r = await ensureAgencyModelDirectChat({ ...baseParams, actingUserId: 'other-user' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(uiCopy.alerts.signInRequired);
    expect(rpc).not.toHaveBeenCalled();
  });
});
