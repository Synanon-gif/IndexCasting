import { syncSingleModelFromMediaslide } from '../mediaslideSyncService';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const fromMock = jest.fn();
const rpcMock = jest.fn().mockResolvedValue({ error: null });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

const getModelByIdFromSupabaseMock = jest.fn();
jest.mock('../modelsSupabase', () => ({
  getModelByIdFromSupabase: (...args: unknown[]) => getModelByIdFromSupabaseMock(...args),
}));

const getModelFromMediaslideMock = jest.fn();
jest.mock('../mediaslideConnector', () => ({
  getModelFromMediaslide: (...args: unknown[]) => getModelFromMediaslideMock(...args),
  syncModelData: jest.fn().mockResolvedValue({ synced: true }),
}));

jest.mock('../supabaseFetchAll', () => ({
  fetchAllSupabasePages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const LOCAL_MODEL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEDIASLIDE_ID = 'ms-model-001';

function makeLocalModel(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCAL_MODEL_ID,
    name: 'Local Model',
    height: 175,
    bust: null,
    waist: 65,
    hips: 90,
    chest: null,
    legs_inseam: null,
    shoe_size: null,
    updated_at: '2024-01-01T10:00:00Z',
    portfolio_images: ['img1.jpg'],
    ...overrides,
  };
}

function makeRemoteModel(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIASLIDE_ID,
    name: 'Remote Model',
    updated_at: '2024-06-01T10:00:00Z',
    measurements: { height: 178, waist: 63 },
    ...overrides,
  };
}

/** Makes supabase.from() return the appropriate mock chain per table. */
function setupSupabaseMock({
  updateError = null,
  terrData = [{ id: 'terr-1' }],
}: {
  updateError?: unknown;
  terrData?: unknown[];
} = {}) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'models') {
      return {
        update: () => ({ eq: () => Promise.resolve({ error: updateError }) }),
        select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      };
    }
    if (table === 'model_agency_territories') {
      return {
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: terrData, error: null }) }) }),
      };
    }
    if (table === 'mediaslide_sync_logs') {
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncSingleModelFromMediaslide', () => {
  beforeEach(() => {
    fromMock.mockReset();
    getModelByIdFromSupabaseMock.mockReset();
    getModelFromMediaslideMock.mockReset();
    setupSupabaseMock();
  });

  it('returns ok=false when local model is not found', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(null);
    getModelFromMediaslideMock.mockResolvedValue(makeRemoteModel());

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(false);
    expect(getModelByIdFromSupabaseMock).toHaveBeenCalledWith(LOCAL_MODEL_ID);
  });

  it('returns ok=false when remote model is not found', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromMediaslideMock.mockResolvedValue(null);

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=false when the connector throws', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromMediaslideMock.mockRejectedValue(new Error('Network error'));

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=false when the DB update fails', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromMediaslideMock.mockResolvedValue(makeRemoteModel());
    setupSupabaseMock({ updateError: { message: 'DB error' } });

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=true and writes updates when remote is strictly newer', async () => {
    const local = makeLocalModel({ updated_at: '2024-01-01T10:00:00Z' });
    const remote = makeRemoteModel({
      updated_at: '2024-06-01T10:00:00Z',
      measurements: { height: 180, waist: 60 },
    });
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce({ ...local, name: 'Remote Model', portfolio_images: ['img1.jpg'] });
    getModelFromMediaslideMock.mockResolvedValue(remote);

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('models');
  });

  it('returns ok=true with no DB write when there are no updates (remote empty)', async () => {
    const local = makeLocalModel();
    const remote = {
      id: MEDIASLIDE_ID,
      updated_at: '2024-06-01T10:00:00Z',
      // No name, city, measurements, etc. — nothing to update
    };
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce(local);
    getModelFromMediaslideMock.mockResolvedValue(remote);
    const updateSpy = jest.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'models') return { update: updateSpy };
      if (table === 'model_agency_territories') {
        return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    // No update call when there is nothing to write
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('local wins on timestamp tie (remote NOT strictly newer)', async () => {
    const sameTs = '2024-03-15T12:00:00Z';
    const local = makeLocalModel({ updated_at: sameTs, height: 175 });
    const remote = makeRemoteModel({
      updated_at: sameTs,
      measurements: { height: 190 }, // would overwrite if remote were newer
    });
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce(local);
    getModelFromMediaslideMock.mockResolvedValue(remote);
    const updateSpy = jest.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'models') return { update: updateSpy };
      if (table === 'model_agency_territories') {
        return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    // Remote name is written (not a measurement), but height is NOT overwritten (tie = local wins)
    expect(result.ok).toBe(true);
    if (updateSpy.mock.calls.length > 0) {
      const updatePayload = updateSpy.mock.calls[0][0];
      // height must NOT be in the update payload (tie — local wins)
      expect(updatePayload).not.toHaveProperty('height');
    }
  });
});
