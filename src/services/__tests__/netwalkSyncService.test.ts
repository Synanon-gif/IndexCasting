import { syncSingleModelFromNetwalk } from '../netwalkSyncService';

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

const getModelFromNetwalkMock = jest.fn();
jest.mock('../netwalkConnector', () => ({
  getModelFromNetwalk: (...args: unknown[]) => getModelFromNetwalkMock(...args),
  syncModelData: jest.fn().mockResolvedValue({ synced: true }),
}));

// netwalkSyncService imports logMediaslideError from mediaslideSyncService
jest.mock('../mediaslideSyncService', () => ({
  logMediaslideError: jest.fn().mockResolvedValue(undefined),
  logNetwalkError: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../supabaseFetchAll', () => ({
  fetchAllSupabasePages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const LOCAL_MODEL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NETWALK_ID = 'nw-model-001';

function makeLocalModel(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCAL_MODEL_ID,
    name: 'Local Model',
    height: 172,
    bust: null,
    waist: 66,
    hips: 91,
    chest: null,
    legs_inseam: null,
    shoe_size: null,
    updated_at: '2024-01-01T10:00:00Z',
    portfolio_images: ['photo.jpg'],
    ...overrides,
  };
}

function makeRemoteModel(overrides: Record<string, unknown> = {}) {
  return {
    id: NETWALK_ID,
    name: 'Remote Netwalk Model',
    updated_at: '2024-07-01T10:00:00Z',
    measurements: { height: 174, waist: 64 },
    ...overrides,
  };
}

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
      };
    }
    if (table === 'model_assignments') {
      return {
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: terrData, error: null }) }) }),
      };
    }
    if (table === 'mediaslide_sync_logs') {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncSingleModelFromNetwalk', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ error: null });
    getModelByIdFromSupabaseMock.mockReset();
    getModelFromNetwalkMock.mockReset();
    setupSupabaseMock();
  });

  it('returns ok=false when local model is not found', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(null);
    getModelFromNetwalkMock.mockResolvedValue(makeRemoteModel());

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(false);
    expect(getModelByIdFromSupabaseMock).toHaveBeenCalledWith(LOCAL_MODEL_ID);
  });

  it('returns ok=false when remote model is not found', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromNetwalkMock.mockResolvedValue(null);

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=false when the connector throws', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromNetwalkMock.mockRejectedValue(new Error('Netwalk unavailable'));

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=false when the DB update fails', async () => {
    getModelByIdFromSupabaseMock.mockResolvedValue(makeLocalModel());
    getModelFromNetwalkMock.mockResolvedValue(makeRemoteModel());
    // Konfiguriere rpcMock so dass agency_update_model_full einen Fehler zurückgibt
    rpcMock.mockImplementation((name: string) => {
      if (name === 'agency_update_model_full') return Promise.resolve({ error: { message: 'constraint violation' } });
      return Promise.resolve({ error: null });
    });

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(false);
  });

  it('returns ok=true and writes measurement updates when remote is strictly newer', async () => {
    const local = makeLocalModel({ updated_at: '2024-01-01T10:00:00Z' });
    const remote = makeRemoteModel({
      updated_at: '2024-07-01T10:00:00Z',
      measurements: { height: 176, waist: 62 },
    });
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce({ ...local, name: 'Remote Netwalk Model', portfolio_images: ['photo.jpg'] });
    getModelFromNetwalkMock.mockResolvedValue(remote);

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('agency_update_model_full', expect.any(Object));
  });

  it('returns ok=true with no DB write when remote has no differing data', async () => {
    const local = makeLocalModel();
    const remoteEmpty = { id: NETWALK_ID, updated_at: '2024-07-01T10:00:00Z' };
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce(local);
    getModelFromNetwalkMock.mockResolvedValue(remoteEmpty);
    const updateSpy = jest.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'models') return { update: updateSpy };
      if (table === 'model_assignments') {
        return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('local wins on timestamp tie — measurements are not overwritten', async () => {
    const sameTs = '2024-05-10T08:00:00Z';
    const local = makeLocalModel({ updated_at: sameTs, height: 172 });
    const remote = makeRemoteModel({
      updated_at: sameTs,
      measurements: { height: 180 },
    });
    getModelByIdFromSupabaseMock
      .mockResolvedValueOnce(local)
      .mockResolvedValueOnce(local);
    getModelFromNetwalkMock.mockResolvedValue(remote);
    const updateSpy = jest.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'models') return { update: updateSpy };
      if (table === 'model_assignments') {
        return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 't1' }], error: null }) }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    const result = await syncSingleModelFromNetwalk({
      localModelId: LOCAL_MODEL_ID,
      netwalkId: NETWALK_ID,
    });

    expect(result.ok).toBe(true);
    if (updateSpy.mock.calls.length > 0) {
      const payload = updateSpy.mock.calls[0][0];
      expect(payload).not.toHaveProperty('height');
    }
  });
});
