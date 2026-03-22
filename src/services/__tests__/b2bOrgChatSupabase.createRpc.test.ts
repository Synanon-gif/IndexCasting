import { createB2bOrgConversationViaRpc } from '../b2bOrgChatSupabase';

const rpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe('createB2bOrgConversationViaRpc', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns conversation id on RPC success', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, conversation_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', created: true },
      error: null,
    });
    const r = await createB2bOrgConversationViaRpc({
      contextId: 'b2b:a:b',
      clientOrgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agencyOrgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      participantIds: ['u1'],
      title: 'Client ↔ Agency',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.conversationId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
      expect(r.created).toBe(true);
    }
    expect(rpc).toHaveBeenCalledWith('create_b2b_org_conversation', expect.any(Object));
  });

  it('maps missing RPC to migration hint', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const r = await createB2bOrgConversationViaRpc({
      contextId: 'b2b:a:b',
      clientOrgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agencyOrgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      participantIds: [],
      title: 't',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('migration_rpc_create_b2b_org_conversation');
  });
});
