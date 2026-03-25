/**
 * Tests for upsertTerritoriesForModel.
 * save_model_territories RPC now RETURNS BOOLEAN (not RETURNS TABLE).
 * After a successful save, the function re-fetches rows via get_territories_for_model RPC.
 */

const rpcMock = jest.fn();
const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { upsertTerritoriesForModel } from '../territoriesSupabase';

describe('upsertTerritoriesForModel', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it('calls save_model_territories then re-fetches via get_territories_for_model', async () => {
    const savedRow = { r_id: 't1', r_model_id: 'm1', r_agency_id: 'a2', r_country_code: 'FR', r_created_at: null };

    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })         // save_model_territories
      .mockResolvedValueOnce({ data: [savedRow], error: null });  // get_territories_for_model

    const result = await upsertTerritoriesForModel('m1', 'a2', [' fr ', 'fr', 'FR']);

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'save_model_territories', {
      p_model_id: 'm1',
      p_agency_id: 'a2',
      p_country_codes: ['FR'],
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'get_territories_for_model', {
      p_model_id: 'm1',
      p_agency_id: 'a2',
    });
    expect(result[0].country_code).toBe('FR');
    expect(result[0].model_id).toBe('m1');
  });

  it('throws when save RPC returns error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Not authorized' } });

    await expect(upsertTerritoriesForModel('m1', 'a2', ['DE'])).rejects.toThrow(
      'Territory save failed: Not authorized',
    );
  });

  it('throws when save RPC returns null data', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(upsertTerritoriesForModel('m1', 'a2', ['DE'])).rejects.toThrow(
      'Territory save failed',
    );
  });

  it('deduplicates and uppercases country codes', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await upsertTerritoriesForModel('m1', 'a2', ['de', 'DE', ' De ', 'AT']);

    const saveCall = rpcMock.mock.calls[0][1] as { p_country_codes: string[] };
    expect(saveCall.p_country_codes.sort()).toEqual(['AT', 'DE']);
  });
});
