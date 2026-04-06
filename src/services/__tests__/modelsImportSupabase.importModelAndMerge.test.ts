/* eslint-disable @typescript-eslint/no-explicit-any */
import { importModelAndMerge } from '../modelsImportSupabase';

const fromMock = jest.fn();
const rpcMock = jest.fn().mockResolvedValue({ error: null });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue([]),
}));

/** Build a fake Supabase lookup chain that resolves with the given row (or null). */
function makeLookupChain(row: Record<string, unknown> | null) {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: row, error: null }));
  return chain;
}

/** Build a fake Supabase update chain that resolves successfully. */
function makeUpdateChain(capturePayload?: (payload: unknown) => void) {
  const chain: any = {};
  chain.update = jest.fn((payload: unknown) => {
    capturePayload?.(payload);
    return chain;
  });
  chain.eq = jest.fn().mockResolvedValue({ error: null });
  return chain;
}

/** Build a fake Supabase insert chain that resolves with the given row. */
function makeInsertChain(row: Record<string, unknown>) {
  const chain: any = {};
  chain.insert = jest.fn(() => chain);
  chain.select = jest.fn(() => chain);
  chain.single = jest.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

describe('importModelAndMerge', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ error: null });
  });

  // ── existing tests (unchanged behaviour) ────────────────────────────────────

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

    fromMock
      .mockReturnValueOnce(makeLookupChain(existing))
      .mockReturnValueOnce(makeUpdateChain());

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
    const noMatch = makeLookupChain(null);

    fromMock
      .mockReturnValueOnce(noMatch)                        // mediaslide_sync_id lookup → null
      .mockReturnValueOnce(makeInsertChain({ id: 'model-2' })); // insert → model-2

    // Email lookup now goes through admin_find_model_by_email RPC (not from()).
    // Must return a chainable object with .maybeSingle() (Gefahr 2 / Risiko D fix).
    rpcMock.mockReturnValueOnce({
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

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

  // ── new: country_code is written on create ──────────────────────────────────

  it('includes country_code in the insert payload', async () => {
    // No mediaslide_sync_id, email, or birthday → no lookups, goes straight to insert.
    let insertedPayload: any;
    const insertChain: any = {};
    insertChain.insert = jest.fn((p: unknown) => { insertedPayload = p; return insertChain; });
    insertChain.select = jest.fn(() => insertChain);
    insertChain.single = jest.fn().mockResolvedValue({ data: { id: 'model-cc' }, error: null });

    fromMock.mockReturnValueOnce(insertChain);

    const res = await importModelAndMerge({
      name: 'Country Code Model',
      height: 175,
      country_code: 'DE',
    });

    expect(res?.created).toBe(true);
    expect(insertedPayload).toMatchObject({ country_code: 'DE' });
  });

  it('fills missing country_code on an existing model via consider()', async () => {
    const existing = {
      id: 'model-nocc',
      mediaslide_sync_id: 'MS-CC',
      name: 'No Country',
      height: 175,
      country_code: null,
      portfolio_images: [],
      polaroids: [],
    };

    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-CC',
      name: 'No Country',
      height: 175,
      country_code: 'FR',
    });

    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', expect.objectContaining({ p_country_code: 'FR' }));
  });

  // ── new: forceUpdateMeasurements overwrites existing measurements ───────────

  it('does NOT overwrite existing measurements without forceUpdateMeasurements', async () => {
    const existing = {
      id: 'model-meas',
      mediaslide_sync_id: 'MS-MEAS',
      name: 'Existing',
      height: 175,
      bust: 88,
      waist: 60,
      hips: 90,
      chest: 88,
      legs_inseam: 80,
      shoe_size: 39,
      portfolio_images: [],
      polaroids: [],
    };

    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-MEAS',
      name: 'Existing',
      height: 180,
      bust: 92,
      waist: 65,
      hips: 95,
      chest: 92,
      legs_inseam: 82,
      shoe_size: 40,
    });

    // All existing measurement fields are non-null → consider() skips them.
    // Either agency_update_model_full is not called at all (empty updates = no change),
    // or if called, p_bust/p_waist/p_hips must be null (COALESCE = no change).
    const rpcParams = rpcMock.mock.calls.find(([name]) => name === 'agency_update_model_full')?.[1];
    expect(rpcParams?.p_bust   ?? null).toBeNull();
    expect(rpcParams?.p_waist  ?? null).toBeNull();
    expect(rpcParams?.p_hips   ?? null).toBeNull();
  });

  it('overwrites existing measurements when forceUpdateMeasurements is true', async () => {
    const existing = {
      id: 'model-force',
      mediaslide_sync_id: 'MS-FORCE',
      name: 'Force Model',
      height: 175,
      bust: 88,
      waist: 60,
      hips: 90,
      chest: 88,
      legs_inseam: 80,
      shoe_size: 39,
      portfolio_images: [],
      polaroids: [],
    };

    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-FORCE',
      name: 'Force Model',
      height: 180,
      bust: 92,
      waist: 65,
      hips: 95,
      chest: 92,
      legs_inseam: 82,
      shoe_size: 40,
      forceUpdateMeasurements: true,
    });

    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', expect.objectContaining({
      p_height: 180,
      p_bust: 92,
      p_waist: 65,
      p_hips: 95,
      p_chest: 92,
      p_legs_inseam: 82,
      p_shoe_size: 40,
    }));
  });

  // ── new: ethnicity and categories are filled for new models ─────────────────

  it('includes ethnicity and categories in the insert payload', async () => {
    // No mediaslide_sync_id, email, or birthday → no lookups, goes straight to insert.
    let insertedPayload: any;
    const insertChain: any = {};
    insertChain.insert = jest.fn((p: unknown) => { insertedPayload = p; return insertChain; });
    insertChain.select = jest.fn(() => insertChain);
    insertChain.single = jest.fn().mockResolvedValue({ data: { id: 'model-eth' }, error: null });

    fromMock.mockReturnValueOnce(insertChain);

    await importModelAndMerge({
      name: 'Ethnicity Model',
      height: 178,
      ethnicity: 'Black / African',
      categories: ['Fashion', 'Commercial'],
    });

    expect(insertedPayload).toMatchObject({
      ethnicity: 'Black / African',
      categories: ['Fashion', 'Commercial'],
    });
  });
});
