import { upsertTerritoriesForModel } from '../territoriesSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe('upsertTerritoriesForModel', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('upserts using UNIQUE(model_id,country_code) and updates agency_id', async () => {
    const deleteNot = jest.fn().mockResolvedValue({ error: null });
    const eqChain = { eq: jest.fn().mockReturnThis(), not: deleteNot };
    const deleteBuilder = { delete: jest.fn().mockReturnValue(eqChain) };

    const upsertPayloads: any[] = [];
    const upsertOptions: any[] = [];

    const orderReturn = Promise.resolve({ data: [{ id: 't1', model_id: 'm1', agency_id: 'a2', country_code: 'FR' }], error: null });
    const upsertChain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnValue(orderReturn),
    };
    const upsertBuilder = {
      upsert: jest.fn().mockImplementation((payload: any[], opts: any) => {
        upsertPayloads.push(...payload);
        upsertOptions.push(opts);
        return upsertChain;
      }),
    };

    fromMock
      .mockReturnValueOnce(deleteBuilder)
      .mockReturnValueOnce(upsertBuilder);

    await upsertTerritoriesForModel('m1', 'a2', [' fr ', 'fr']);

    expect(fromMock).toHaveBeenCalledWith('model_agency_territories');
    expect(upsertOptions[0]).toEqual({ onConflict: 'model_id,country_code' });
    expect(upsertPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model_id: 'm1', agency_id: 'a2', country_code: 'FR' }),
      ]),
    );
  });
});

