import {
  ensureAgencyModelDirectConversation,
  ensureAgencyModelDirectConversationWithRetry,
} from '../b2bOrgChatSupabase';

const rpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe('ensureAgencyModelDirectConversation', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns conversation id on RPC success', async () => {
    rpc.mockResolvedValue({ data: '11111111-1111-1111-1111-111111111111', error: null });
    const id = await ensureAgencyModelDirectConversation('ag-1', 'model-1');
    expect(id).toBe('11111111-1111-1111-1111-111111111111');
    expect(rpc).toHaveBeenCalledWith('ensure_agency_model_direct_conversation', {
      p_agency_id: 'ag-1',
      p_model_id: 'model-1',
    });
  });

  it('returns null on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'access_denied' } });
    await expect(ensureAgencyModelDirectConversation('a', 'm')).resolves.toBeNull();
  });

  it('returns null on no_active_representation (MAT gate)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'no_active_representation', code: 'P0001' },
    });
    await expect(ensureAgencyModelDirectConversation('ag-1', 'model-1')).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith('ensure_agency_model_direct_conversation', {
      p_agency_id: 'ag-1',
      p_model_id: 'model-1',
    });
  });

  it('returns null and skips RPC when agency id is empty', async () => {
    await expect(ensureAgencyModelDirectConversation('', 'm')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('ensureAgencyModelDirectConversationWithRetry', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns id on first successful RPC', async () => {
    rpc.mockResolvedValue({ data: 'conv-a', error: null });
    const id = await ensureAgencyModelDirectConversationWithRetry('ag', 'mdl', { delayMs: 5 });
    expect(id).toBe('conv-a');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('retries when first RPC returns empty id', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 'conv-b', error: null });
    const id = await ensureAgencyModelDirectConversationWithRetry('ag', 'mdl', {
      attempts: 2,
      delayMs: 5,
    });
    expect(id).toBe('conv-b');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
