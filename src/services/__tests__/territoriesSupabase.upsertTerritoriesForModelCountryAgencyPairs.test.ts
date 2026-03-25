import { upsertTerritoriesForModelCountryAgencyPairs } from '../territoriesSupabase';

const rpcMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe('upsertTerritoriesForModelCountryAgencyPairs', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('calls save_model_territories per agency and deduplicates by country_code', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 't1' }], error: null });

    await upsertTerritoriesForModelCountryAgencyPairs('m1', [
      { country_code: ' fr ', agency_id: 'a1' },
      { country_code: 'FR', agency_id: 'a2' }, // same country — last one wins (a2)
      { country_code: ' de ', agency_id: 'a2' },
    ]);

    // a2 should receive ['FR', 'DE'] (the deduplicated result for a2)
    expect(rpcMock).toHaveBeenCalledWith('save_model_territories', {
      p_model_id: 'm1',
      p_agency_id: 'a2',
      p_country_codes: expect.arrayContaining(['FR', 'DE']),
    });
  });

  it('returns empty array when no pairs are passed', async () => {
    const result = await upsertTerritoriesForModelCountryAgencyPairs('m1', []);
    expect(result).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
