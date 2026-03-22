import { ensurePlainSignupB2bOwnerBootstrap } from '../b2bOwnerBootstrapSupabase';

const rpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe('b2bOwnerBootstrapSupabase', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns error: null when RPC succeeds', async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await ensurePlainSignupB2bOwnerBootstrap();
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('ensure_plain_signup_b2b_owner_bootstrap');
  });

  it('returns error when RPC fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'rpc failed' } });
    const r = await ensurePlainSignupB2bOwnerBootstrap();
    expect(r.error?.message).toBe('rpc failed');
  });
});
