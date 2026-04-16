/**
 * Tests for modelLocationsSupabase.ts
 *
 * Key scenarios:
 *   1. roundCoord — privacy-safe coordinate rounding (~5 km precision)
 *   2. upsertModelLocation — rounds coords before RPC, handles share toggle
 *   3. getModelLocation — delegates to .from().select().eq().maybeSingle()
 *   4. deleteModelLocation — delegates to .from().delete().eq()
 *   5. getModelsNearLocation — passes rounded coords + filters to RPC
 */

const rpcMock = jest.fn();
const fromMock = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

// fetchAllSupabasePages just calls the callback once with (0, 999)
jest.mock('../supabaseFetchAll', () => ({
  fetchAllSupabasePages: async (
    fn: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>,
  ) => {
    const { data, error } = await fn(0, 999);
    if (error) return [];
    return data ?? [];
  },
}));

import {
  roundCoord,
  upsertModelLocation,
  getModelLocation,
  deleteModelLocation,
  getModelsNearLocation,
  mergeEffectiveDisplayCitiesFromRows,
  mergeEffectiveApproxCoordsFromRows,
} from '../modelLocationsSupabase';

// ── mergeEffectiveDisplayCitiesFromRows ───────────────────────────────────────

describe('mergeEffectiveDisplayCitiesFromRows', () => {
  it('prefers live over current over agency for same model', () => {
    const m = mergeEffectiveDisplayCitiesFromRows([
      { model_id: 'a', city: 'AgencyTown', source: 'agency' },
      { model_id: 'a', city: 'CurrentTown', source: 'current' },
      { model_id: 'a', city: 'LiveTown', source: 'live' },
    ]);
    expect(m.get('a')).toBe('LiveTown');
  });

  it('skips empty cities and handles unknown source as agency priority', () => {
    const m = mergeEffectiveDisplayCitiesFromRows([
      { model_id: 'b', city: '   ', source: 'live' },
      { model_id: 'b', city: 'Fallback', source: 'other' },
    ]);
    expect(m.get('b')).toBe('Fallback');
  });

  it('uses agency when it is the only row with a city', () => {
    const m = mergeEffectiveDisplayCitiesFromRows([
      { model_id: 'c', city: 'Innsbruck', source: 'agency' },
    ]);
    expect(m.get('c')).toBe('Innsbruck');
  });

  it('prefers current over agency when live is absent', () => {
    const m = mergeEffectiveDisplayCitiesFromRows([
      { model_id: 'd', city: 'AgencyCity', source: 'agency' },
      { model_id: 'd', city: 'ModelTypedCity', source: 'current' },
    ]);
    expect(m.get('d')).toBe('ModelTypedCity');
  });
});

// ── mergeEffectiveApproxCoordsFromRows ────────────────────────────────────────

describe('mergeEffectiveApproxCoordsFromRows', () => {
  it('prefers live coords over current when both shared', () => {
    const m = mergeEffectiveApproxCoordsFromRows([
      {
        model_id: 'a',
        source: 'agency',
        lat_approx: 1,
        lng_approx: 1,
        share_approximate_location: true,
      },
      {
        model_id: 'a',
        source: 'current',
        lat_approx: 2,
        lng_approx: 2,
        share_approximate_location: true,
      },
      {
        model_id: 'a',
        source: 'live',
        lat_approx: 3,
        lng_approx: 3,
        share_approximate_location: true,
      },
    ]);
    expect(m.get('a')).toEqual({ lat_approx: 3, lng_approx: 3 });
  });

  it('ignores rows without share_approximate_location or missing coords', () => {
    const m = mergeEffectiveApproxCoordsFromRows([
      {
        model_id: 'b',
        source: 'live',
        lat_approx: 10,
        lng_approx: 10,
        share_approximate_location: false,
      },
      {
        model_id: 'b',
        source: 'agency',
        lat_approx: null,
        lng_approx: 5,
        share_approximate_location: true,
      },
      {
        model_id: 'b',
        source: 'current',
        lat_approx: 4,
        lng_approx: 4,
        share_approximate_location: true,
      },
    ]);
    expect(m.get('b')).toEqual({ lat_approx: 4, lng_approx: 4 });
  });
});

// ── roundCoord ────────────────────────────────────────────────────────────────

describe('roundCoord', () => {
  it('rounds to nearest 0.05 (~5 km precision)', () => {
    expect(roundCoord(48.1234)).toBe(48.1);
    expect(roundCoord(48.175)).toBe(48.2);
    expect(roundCoord(13.0)).toBe(13.0);
    expect(roundCoord(-33.8688)).toBe(-33.85);
  });

  it('never stores more than 2 significant post-decimal digits', () => {
    const result = roundCoord(51.509865);
    const str = result.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ── upsertModelLocation ───────────────────────────────────────────────────────

describe('upsertModelLocation', () => {
  beforeEach(() => rpcMock.mockReset());

  it('rounds coordinates before calling RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-1', {
      country_code: 'DE',
      city: 'Berlin',
      lat: 52.519444,
      lng: 13.406667,
      share_approximate_location: true,
    });

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_lat_approx).toBe(roundCoord(52.519444));
    expect(call.p_lng_approx).toBe(roundCoord(13.406667));
    expect(call.p_country_code).toBe('DE');
    expect(call.p_source).toBe('current');
  });

  it('sets lat/lng to null when share_approximate_location = false', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-1', {
      country_code: 'DE',
      city: 'Berlin',
      lat: 52.5,
      lng: 13.4,
      share_approximate_location: false,
    });

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_lat_approx).toBeNull();
    expect(call.p_lng_approx).toBeNull();
    expect(call.p_share_approximate_location).toBe(false);
  });

  it('uses source agency when specified', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-2', { country_code: 'FR' }, 'agency');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_source).toBe('agency');
  });

  it('returns false and logs on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RLS violation' } });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await upsertModelLocation('model-1', { country_code: 'DE' });

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('upsertModelLocation error:', expect.anything());
    consoleSpy.mockRestore();
  });

  it('returns true on success', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await upsertModelLocation('model-1', { country_code: 'AT' });
    expect(result).toBe(true);
  });
});

// ── getModelLocation (multi-row, priority-aware) ──────────────────────────────

describe('getModelLocation', () => {
  beforeEach(() => fromMock.mockReset());

  it('returns highest-priority location when multiple sources exist', async () => {
    const liveRow = {
      id: 'loc-live',
      model_id: 'model-1',
      city: 'Berlin',
      country_code: 'DE',
      lat_approx: 52.5,
      lng_approx: 13.4,
      share_approximate_location: true,
      source: 'live',
      updated_at: '2024-01-02T00:00:00Z',
    };
    const agencyRow = {
      id: 'loc-agency',
      model_id: 'model-1',
      city: 'Munich',
      country_code: 'DE',
      lat_approx: 48.1,
      lng_approx: 11.6,
      share_approximate_location: true,
      source: 'agency',
      updated_at: '2024-01-01T00:00:00Z',
    };
    // Returns both rows; live should win (priority 2 > 0)
    fromMock.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [agencyRow, liveRow], error: null }),
      }),
    });

    const result = await getModelLocation('model-1');
    expect(result?.source).toBe('live');
    expect(result?.city).toBe('Berlin');
  });

  it('returns current when live is absent', async () => {
    const currentRow = {
      id: 'loc-current',
      model_id: 'model-1',
      city: 'Hamburg',
      country_code: 'DE',
      lat_approx: 53.55,
      lng_approx: 10.0,
      share_approximate_location: true,
      source: 'current',
      updated_at: '2024-01-01T00:00:00Z',
    };
    fromMock.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [currentRow], error: null }),
      }),
    });

    const result = await getModelLocation('model-1');
    expect(result?.source).toBe('current');
  });

  it('returns null when no location exists', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
    });

    const result = await getModelLocation('model-unknown');
    expect(result).toBeNull();
  });

  it('returns null and logs on DB error', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: null, error: { message: 'DB error' } }),
      }),
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getModelLocation('model-1');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── deleteModelLocation (source-aware via RPC) ────────────────────────────────

describe('deleteModelLocation', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls delete_model_location_source RPC with source when provided', async () => {
    rpcMock.mockResolvedValue({ error: null });

    const result = await deleteModelLocation('model-1', 'live');
    expect(result).toBe(true);
    const call = rpcMock.mock.calls[0];
    expect(call[0]).toBe('delete_model_location_source');
    expect(call[1]).toEqual({ p_model_id: 'model-1', p_source: 'live' });
  });

  it('calls RPC with p_source=null when no source specified (removes live+current only)', async () => {
    rpcMock.mockResolvedValue({ error: null });

    const result = await deleteModelLocation('model-1');
    expect(result).toBe(true);
    const call = rpcMock.mock.calls[0];
    expect(call[1]).toEqual({ p_model_id: 'model-1', p_source: null });
  });

  it('returns false and logs on RPC error', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'access_denied' } });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await deleteModelLocation('model-1', 'current');
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});

// ── getModelsNearLocation ─────────────────────────────────────────────────────

describe('getModelsNearLocation', () => {
  beforeEach(() => rpcMock.mockReset());

  it('passes rounded client coordinates to RPC', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getModelsNearLocation(48.858093, 2.294694, 50, 'all');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_lat).toBe(roundCoord(48.858093));
    expect(call.p_lng).toBe(roundCoord(2.294694));
    expect(call.p_radius_km).toBe(50);
    expect(call.p_client_type).toBe('all');
  });

  it('passes measurement filters when provided', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getModelsNearLocation(52.52, 13.4, 30, 'fashion', {
      heightMin: 170,
      heightMax: 185,
      sex: 'female',
    });

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_height_min).toBe(170);
    expect(call.p_height_max).toBe(185);
    expect(call.p_sex).toBe('female');
    expect(call.p_client_type).toBe('fashion');
  });

  it('returns empty array on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'error' } });
    const result = await getModelsNearLocation(0, 0);
    expect(result).toEqual([]);
  });

  it('privacy: passes rounded coords, not exact GPS', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const exactLat = 51.509865;
    const exactLng = -0.118092;

    await getModelsNearLocation(exactLat, exactLng, 50);

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_lat).not.toBe(exactLat);
    expect(call.p_lng).not.toBe(exactLng);
    expect(call.p_lat).toBe(roundCoord(exactLat));
    expect(call.p_lng).toBe(roundCoord(exactLng));
  });

  it('does NOT pass a city parameter — city is display-only, filtering uses lat/lng', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getModelsNearLocation(48.85, 2.35, 50);

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    // The RPC call must not contain any city filter param
    expect(call).not.toHaveProperty('p_city');
  });
});

// ── Source isolation (multi-row: each source has its own row) ────────────────

describe('source isolation: UNIQUE(model_id, source) — each source is independent', () => {
  beforeEach(() => rpcMock.mockReset());

  it('upsertModelLocation with source=agency writes to the agency row only', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-1', { country_code: 'DE', city: 'Hamburg' }, 'agency');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_source).toBe('agency');
    expect(call.p_model_id).toBe('model-1');
    // With UNIQUE(model_id, source), agency write goes to (model-1, 'agency') row only.
    // Live/current rows of this model are structurally unaffected.
  });

  it('upsertModelLocation with source=current writes to the current row only', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-1', { country_code: 'FR', city: 'Paris' }, 'current');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_source).toBe('current');
    expect(call.p_country_code).toBe('FR');
    // Agency row of this model is structurally unaffected.
  });
});
