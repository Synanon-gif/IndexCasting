/**
 * Tests for modelLocationsSupabase.ts
 *
 * Key scenarios:
 *   1. roundCoord — privacy-safe coordinate rounding (~5 km precision)
 *   2. upsertModelLocation — rounds coords before RPC, handles share toggle
 *   3. bulkUpsertModelLocations — empty array guard, rounds coords, calls RPC
 *   4. getModelLocation — delegates to .from().select().eq().maybeSingle()
 *   5. deleteModelLocation — delegates to .from().delete().eq()
 *   6. getModelsNearLocation — passes rounded coords + filters to RPC
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
  fetchAllSupabasePages: async (fn: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>) => {
    const { data, error } = await fn(0, 999);
    if (error) return [];
    return data ?? [];
  },
}));

import {
  roundCoord,
  upsertModelLocation,
  bulkUpsertModelLocations,
  getModelLocation,
  deleteModelLocation,
  getModelsNearLocation,
} from '../modelLocationsSupabase';

// ── roundCoord ────────────────────────────────────────────────────────────────

describe('roundCoord', () => {
  it('rounds to nearest 0.05 (~5 km precision)', () => {
    expect(roundCoord(48.1234)).toBe(48.1);
    expect(roundCoord(48.1750)).toBe(48.2);
    expect(roundCoord(13.0000)).toBe(13.0);
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
    expect(call.p_source).toBe('model');
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

// ── bulkUpsertModelLocations ──────────────────────────────────────────────────

describe('bulkUpsertModelLocations', () => {
  beforeEach(() => rpcMock.mockReset());

  it('returns 0 immediately for empty model list', async () => {
    const result = await bulkUpsertModelLocations([], { country_code: 'DE' });
    expect(result).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rounds coordinates before calling RPC', async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });

    await bulkUpsertModelLocations(['m1', 'm2', 'm3'], {
      country_code: 'IT',
      city: 'Milan',
      lat: 45.464664,
      lng: 9.188540,
    });

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_lat_approx).toBe(roundCoord(45.464664));
    expect(call.p_lng_approx).toBe(roundCoord(9.188540));
    expect(call.p_model_ids).toEqual(['m1', 'm2', 'm3']);
    expect(call.p_country_code).toBe('IT');
  });

  it('returns the RPC count on success', async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const count = await bulkUpsertModelLocations(['a', 'b', 'c', 'd', 'e'], { country_code: 'FR' });
    expect(count).toBe(5);
  });

  it('returns 0 and logs on error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'Unauthorized' } });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const count = await bulkUpsertModelLocations(['m1'], { country_code: 'DE' });

    expect(count).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith('bulkUpsertModelLocations error:', expect.anything());
    consoleSpy.mockRestore();
  });
});

// ── getModelLocation ──────────────────────────────────────────────────────────

describe('getModelLocation', () => {
  beforeEach(() => fromMock.mockReset());

  it('returns location when found', async () => {
    const mockLocation = {
      id: 'loc-1',
      model_id: 'model-1',
      city: 'Hamburg',
      country_code: 'DE',
      lat_approx: 53.55,
      lng_approx: 10.0,
      share_approximate_location: true,
      source: 'model',
      updated_at: '2024-01-01T00:00:00Z',
    };

    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockLocation, error: null }),
        }),
      }),
    });

    const result = await getModelLocation('model-1');
    expect(result).toEqual(mockLocation);
  });

  it('returns null when no location exists', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    });

    const result = await getModelLocation('model-unknown');
    expect(result).toBeNull();
  });

  it('returns null and logs on DB error', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getModelLocation('model-1');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── deleteModelLocation ───────────────────────────────────────────────────────

describe('deleteModelLocation', () => {
  beforeEach(() => fromMock.mockReset());

  it('returns true on successful delete', async () => {
    fromMock.mockReturnValue({
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    });

    const result = await deleteModelLocation('model-1');
    expect(result).toBe(true);
  });

  it('returns false and logs on error', async () => {
    fromMock.mockReturnValue({
      delete: () => ({
        eq: async () => ({ error: { message: 'Not found' } }),
      }),
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await deleteModelLocation('model-1');
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

// ── Source priority (model vs agency) ────────────────────────────────────────

describe('source priority: latest updated_at wins', () => {
  beforeEach(() => rpcMock.mockReset());

  it('upsertModelLocation with source=agency overwrites a model-set location', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    // Agency sets location after model did (simulated by calling agency upsert)
    await upsertModelLocation('model-1', { country_code: 'DE', city: 'Hamburg' }, 'agency');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    // source=agency should be forwarded to the RPC which does an UPSERT ON CONFLICT
    expect(call.p_source).toBe('agency');
    // UNIQUE(model_id) + UPSERT means the DB keeps the single latest row
    expect(call.p_model_id).toBe('model-1');
  });

  it('upsertModelLocation with source=model can override an agency-set location', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await upsertModelLocation('model-1', { country_code: 'FR', city: 'Paris' }, 'model');

    const call = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_source).toBe('model');
    expect(call.p_country_code).toBe('FR');
  });
});
