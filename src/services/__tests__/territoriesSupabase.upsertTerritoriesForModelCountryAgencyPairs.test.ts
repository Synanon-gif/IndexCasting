import { upsertTerritoriesForModelCountryAgencyPairs } from '../territoriesSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe('upsertTerritoriesForModelCountryAgencyPairs', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('upserts with onConflict model_id,country_code and deduplicates by country_code', async () => {
    const orderReturn = Promise.resolve({ data: [{ id: 't1' }], error: null });
    const upsertChain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue(orderReturn),
    };

    const upsertPayloads: any[] = [];
    const upsertBuilder = {
      upsert: jest.fn().mockImplementation((payload: any[], opts: any) => {
        upsertPayloads.push(...payload);
        expect(opts).toEqual({ onConflict: 'model_id,country_code' });
        return upsertChain;
      }),
    };

    fromMock.mockReturnValueOnce(upsertBuilder);

    await upsertTerritoriesForModelCountryAgencyPairs('m1', [
      { country_code: ' fr ', agency_id: 'a1' },
      { country_code: 'FR', agency_id: 'a2' }, // same country, should win (last)
      { country_code: ' de ', agency_id: 'a3' },
    ]);

    // Should only contain FR and DE once each.
    const countries = Array.from(new Set(upsertPayloads.map((p) => p.country_code)));
    expect(countries.sort()).toEqual(['DE', 'FR']);
  });
});

