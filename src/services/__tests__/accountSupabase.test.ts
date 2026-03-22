import { requestAccountDeletion } from '../accountSupabase';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

describe('requestAccountDeletion', () => {
  const err = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });
  afterAll(() => {
    console.error = err;
  });

  it('returns ok when RPC returns true', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: true, error: null });
    await expect(requestAccountDeletion()).resolves.toEqual({ ok: true });
  });

  it('returns not_owner when RPC raises owner-only error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'only_organization_owner_can_delete_account' },
    });
    await expect(requestAccountDeletion()).resolves.toEqual({ ok: false, reason: 'not_owner' });
  });

  it('returns failed on generic error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'other' },
    });
    await expect(requestAccountDeletion()).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
