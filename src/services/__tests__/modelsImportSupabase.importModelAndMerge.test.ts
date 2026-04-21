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
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
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

    fromMock.mockReturnValueOnce(makeLookupChain(existing)).mockReturnValueOnce(makeUpdateChain());

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
      .mockReturnValueOnce(noMatch) // mediaslide_sync_id lookup → null
      .mockReturnValueOnce(makeInsertChain({ id: 'model-2' })); // insert → model-2

    // Email lookup goes through agency_find_model_by_email RPC (agency-scoped, not admin).
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
    insertChain.insert = jest.fn((p: unknown) => {
      insertedPayload = p;
      return insertChain;
    });
    insertChain.select = jest.fn(() => insertChain);
    insertChain.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { id: 'model-cc' }, error: null });

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

    expect(rpcMock).toHaveBeenCalledWith(
      'agency_update_model_full',
      expect.objectContaining({ p_country_code: 'FR' }),
    );
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
    expect(rpcParams?.p_bust ?? null).toBeNull();
    expect(rpcParams?.p_waist ?? null).toBeNull();
    expect(rpcParams?.p_hips ?? null).toBeNull();
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

    expect(rpcMock).toHaveBeenCalledWith(
      'agency_update_model_full',
      expect.objectContaining({
        p_height: 180,
        p_bust: 92,
        p_waist: 65,
        p_hips: 95,
        p_chest: 92,
        p_legs_inseam: 82,
        p_shoe_size: 40,
      }),
    );
  });

  // ── new: forceUpdateAppearance overwrites hair / eye colour ─────────────────

  it('does NOT overwrite existing hair_color / eye_color without forceUpdateAppearance', async () => {
    // Symmetry test for the measurement story above — by default the package
    // is treated as a "fill the gaps" source, so an agency that hand-edited
    // a model's hair colour after the last import keeps that local value on
    // the next re-import. Updates flow through the `agency_update_model_full`
    // RPC, so the assertion looks at how the RPC was called (or whether it
    // was called at all when nothing changed).
    const existing = {
      id: 'model-app',
      mediaslide_sync_id: 'MS-APP',
      name: 'App Model',
      height: 180,
      hair_color: 'Brunette (manual edit)',
      eye_color: 'Hazel (manual edit)',
      portfolio_images: [],
      polaroids: [],
    };
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-APP',
      name: 'App Model',
      height: 180,
      hair_color: 'Blonde',
      eye_color: 'Blue',
    });

    const updateCalls = rpcMock.mock.calls.filter((c) => c[0] === 'agency_update_model_full');
    // Either the RPC was not called (nothing to update) OR it was called with
    // null/undefined for the colour params — both prove the colours stayed.
    for (const c of updateCalls) {
      const params = c[1] as { p_hair_color?: unknown; p_eye_color?: unknown };
      expect(params.p_hair_color ?? null).toBeNull();
      expect(params.p_eye_color ?? null).toBeNull();
    }
  });

  it('overwrites hair_color / eye_color when forceUpdateAppearance is true', async () => {
    // Authoritative-package path: agency ticked the new "Overwrite hair/eye
    // colour on known models" checkbox → updates RPC carries the new strings.
    const existing = {
      id: 'model-app2',
      mediaslide_sync_id: 'MS-APP2',
      name: 'App Model 2',
      height: 180,
      hair_color: 'Brown',
      eye_color: 'Brown',
      portfolio_images: [],
      polaroids: [],
    };
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-APP2',
      name: 'App Model 2',
      height: 180,
      hair_color: 'Platinum Blonde',
      eye_color: 'Steel Blue',
      forceUpdateAppearance: true,
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'agency_update_model_full',
      expect.objectContaining({
        p_hair_color: 'Platinum Blonde',
        p_eye_color: 'Steel Blue',
      }),
    );
  });

  it('forceUpdateAppearance does NOT touch measurements (independent flags)', async () => {
    // Defense check: turning on appearance-force MUST NOT re-route into the
    // measurement force path. Otherwise an agency that wanted to refresh
    // colours only would have their hand-edited measurements wiped too.
    const existing = {
      id: 'model-app3',
      mediaslide_sync_id: 'MS-APP3',
      name: 'App Model 3',
      height: 180,
      bust: 88,
      waist: 60,
      hips: 90,
      hair_color: 'Brown',
      eye_color: 'Brown',
      portfolio_images: [],
      polaroids: [],
    };
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    await importModelAndMerge({
      mediaslide_sync_id: 'MS-APP3',
      name: 'App Model 3',
      height: 999, // would-be authoritative if measurements were forced
      bust: 999,
      hair_color: 'Auburn',
      eye_color: 'Green',
      forceUpdateAppearance: true,
      forceUpdateMeasurements: false,
    });

    expect(rpcMock).toHaveBeenCalledWith(
      'agency_update_model_full',
      expect.objectContaining({
        p_hair_color: 'Auburn',
        p_eye_color: 'Green',
        // height / bust must NOT be in the updated payload — `consider` saw
        // existing non-null values and refused to overwrite without the
        // measurement-force flag.
        p_height: null,
        p_bust: null,
      }),
    );
  });

  // ── new: ethnicity and categories are filled for new models ─────────────────

  it('includes ethnicity and categories in the insert payload', async () => {
    // No mediaslide_sync_id, email, or birthday → no lookups, goes straight to insert.
    let insertedPayload: any;
    const insertChain: any = {};
    insertChain.insert = jest.fn((p: unknown) => {
      insertedPayload = p;
      return insertChain;
    });
    insertChain.select = jest.fn(() => insertChain);
    insertChain.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { id: 'model-eth' }, error: null });

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

  it('sets externalSyncIdsPersistFailed when update_model_sync_ids fails on existing row', async () => {
    const existing = {
      id: 'model-nw-sync-fail',
      mediaslide_sync_id: null,
      netwalk_model_id: 'NW-SYNC-FAIL',
      name: 'Netwalk Match',
      height: 180,
      bust: null,
      waist: null,
      hips: null,
      chest: null,
      legs_inseam: null,
      shoe_size: null,
      city: null,
      country_code: null,
      hair_color: null,
      eye_color: null,
      ethnicity: null,
      current_location: null,
      sex: null,
      categories: null,
      portfolio_images: [] as string[],
      polaroids: [] as string[],
    };

    // No mediaslide_sync_id → only the netwalk lookup hits from().
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'update_model_sync_ids') {
        return { data: null, error: { message: 'sync_ids_failed' } };
      }
      return { data: null, error: null };
    });

    const res = await importModelAndMerge({
      netwalk_model_id: 'NW-SYNC-FAIL',
      name: 'Netwalk Match',
      height: 180,
    });

    expect(res?.created).toBe(false);
    expect(res?.model_id).toBe('model-nw-sync-fail');
    expect(res?.externalSyncIdsPersistFailed).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Territory-write robustness — the user-facing "I entered a territory but
  // nothing was saved" bug. Before the fix, a thrown
  // upsertTerritoriesForModelCountryAgencyPairs would be swallowed by the
  // outer try/catch and the function returned null — the model row was
  // already updated/created, leaving the agency in a confused state. After
  // the fix, the result MUST contain `territoriesPersistFailed: true` so the
  // UI can surface a warning, and the model_id MUST still be returned so the
  // caller knows the row exists.
  // ──────────────────────────────────────────────────────────────────────────
  it('surfaces territoriesPersistFailed:true on the MERGE path when MAT write throws (model still returned)', async () => {
    const existing = {
      id: 'model-merge-terr',
      mediaslide_sync_id: 'MS-TERR',
      name: 'Merge w/ territory fail',
      height: 180,
      bust: null,
      waist: null,
      hips: null,
      chest: null,
      legs_inseam: null,
      shoe_size: null,
      city: null,
      country_code: null,
      hair_color: null,
      eye_color: null,
      ethnicity: null,
      current_location: null,
      sex: null,
      categories: null,
      portfolio_images: [] as string[],
      polaroids: [] as string[],
    };
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    const territoriesMod = await import('../territoriesSupabase');
    (territoriesMod.upsertTerritoriesForModelCountryAgencyPairs as jest.Mock).mockRejectedValueOnce(
      new Error('rls_denied_for_agency'),
    );

    const res = await importModelAndMerge({
      mediaslide_sync_id: 'MS-TERR',
      name: 'Merge w/ territory fail',
      height: 180,
      territories: [{ country_code: 'AT', agency_id: 'agency-1' }],
    });

    expect(res?.model_id).toBe('model-merge-terr');
    expect(res?.created).toBe(false);
    expect(res?.territoriesPersistFailed).toBe(true);
    expect(res?.territoriesPersistFailureReason).toMatch(/rls_denied_for_agency/);
  });

  it('surfaces territoriesPersistFailed:true on the INSERT path when MAT write throws (model still created)', async () => {
    fromMock
      .mockReturnValueOnce(makeLookupChain(null)) // mediaslide lookup → null
      .mockReturnValueOnce(makeInsertChain({ id: 'model-new-terr-fail' }));
    rpcMock.mockReturnValueOnce({
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

    const territoriesMod = await import('../territoriesSupabase');
    (territoriesMod.upsertTerritoriesForModelCountryAgencyPairs as jest.Mock).mockRejectedValueOnce(
      new Error('save_model_territories_returned_false'),
    );

    const res = await importModelAndMerge({
      mediaslide_sync_id: 'MS-NEW-T',
      email: 'new+territory@example.com',
      name: 'Brand-new Model',
      height: 175,
      territories: [{ country_code: 'AT', agency_id: 'agency-1' }],
    });

    expect(res?.model_id).toBe('model-new-terr-fail');
    expect(res?.created).toBe(true);
    expect(res?.territoriesPersistFailed).toBe(true);
    expect(res?.territoriesPersistFailureReason).toMatch(/save_model_territories_returned_false/);
  });

  it('does NOT set territoriesPersistFailed when MAT write succeeds', async () => {
    const existing = {
      id: 'model-ok-terr',
      mediaslide_sync_id: 'MS-OK',
      name: 'OK',
      height: 180,
      portfolio_images: [],
      polaroids: [],
    };
    fromMock.mockReturnValueOnce(makeLookupChain(existing));

    const territoriesMod = await import('../territoriesSupabase');
    (territoriesMod.upsertTerritoriesForModelCountryAgencyPairs as jest.Mock).mockResolvedValueOnce(
      [],
    );

    const res = await importModelAndMerge({
      mediaslide_sync_id: 'MS-OK',
      name: 'OK',
      height: 180,
      territories: [{ country_code: 'AT', agency_id: 'agency-1' }],
    });

    expect(res?.model_id).toBe('model-ok-terr');
    expect(res?.territoriesPersistFailed).toBeUndefined();
    expect(res?.territoriesPersistFailureReason).toBeUndefined();
  });
});
