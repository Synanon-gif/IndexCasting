import { importModelAndMerge } from '../modelsImportSupabase';

const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

describe('importModelAndMerge', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('updates existing model and merges portfolio_images without duplicates', async () => {
    const existing = {
      id: 'model-1',
      mediaslide_sync_id: 'MS-001',
      email: 'x@example.com',
      name: 'Existing',
      height: 180,
      bust: null,
      waist: null,
      hips: null,
      city: null,
      hair_color: null,
      eye_color: null,
      current_location: null,
      portfolio_images: ['a.jpg'],
      polaroids: ['p1.jpg'],
      is_visible_commercial: true,
      is_visible_fashion: false,
      agency_id: null,
    };

    const maybeSingleReturn = Promise.resolve({ data: existing, error: null });
    const lookupChain: any = {};
    lookupChain.select = jest.fn(() => lookupChain);
    lookupChain.eq = jest.fn(() => lookupChain);
    lookupChain.maybeSingle = jest.fn(() => maybeSingleReturn);

    const updateChain: any = {};
    updateChain.update = jest.fn(() => updateChain);
    updateChain.eq = jest.fn().mockResolvedValue({ error: null });

    fromMock
      .mockReturnValueOnce(lookupChain as any)
      .mockReturnValueOnce(updateChain as any);

    const res = await importModelAndMerge({
      mediaslide_sync_id: 'MS-001',
      email: 'x@example.com',
      name: 'Incoming Name',
      height: 180,
      bust: 90,
      portfolio_images: ['a.jpg', 'b.jpg'],
      polaroids: ['p1.jpg', 'p2.jpg'],
      agency_id: 'agency-1',
    });

    expect(res?.created).toBe(false);
    expect(res?.model_id).toBe('model-1');
  });

  it('creates a new model when no match is found', async () => {
    const noneReturn = Promise.resolve({ data: null, error: null });
    const lookupChain: any = {};
    lookupChain.select = jest.fn(() => lookupChain);
    lookupChain.eq = jest.fn(() => lookupChain);
    lookupChain.maybeSingle = jest.fn(() => noneReturn);

    const createdRow = { id: 'model-2' };
    const insertChain: any = {};
    insertChain.insert = jest.fn(() => insertChain);
    insertChain.select = jest.fn(() => insertChain);
    insertChain.single = jest.fn().mockResolvedValue({ data: createdRow, error: null });

    fromMock
      .mockReturnValueOnce(lookupChain as any)
      .mockReturnValueOnce(lookupChain as any)
      .mockReturnValueOnce(insertChain as any);

    const res = await importModelAndMerge({
      mediaslide_sync_id: 'MS-999',
      email: 'new@example.com',
      name: 'New Model',
      height: 170,
      portfolio_images: ['x.jpg'],
      polaroids: [],
    });

    expect(res?.created).toBe(true);
    expect(res?.model_id).toBe('model-2');
  });
});

