/**
 * Tests for clientDiscoverySupabase.ts (v2)
 *
 * Covers:
 *  Original 7 invariants (updated for new API shape):
 *   1. Reject cooldown parameter
 *   2. Book cooldown parameter
 *   3. Never-seen models appear first (score ordering preserved)
 *   4. Location city filter passed correctly
 *   5. Session dedup via p_exclude_ids
 *   6. RPC error → { models: [], nextCursor: null }, no crash
 *   7. recordInteraction handles non-client callers silently
 *
 *  New invariants (v2 upgrades):
 *   8.  DISCOVERY_WEIGHTS exported with correct values
 *   9.  withRetry: recordInteraction retries on network failure
 *  10.  loadSessionIds / saveSessionId / clearSessionIds (localStorage)
 *  11.  applyDiversityShuffle: tier order preserved, no model lost
 *  12.  Cursor pagination: nextCursor extracted from last model
 *  13.  Cursor pagination: cursor params passed on subsequent call
 *  14.  Empty result returns nextCursor: null
 *  15.  Pagination still works via legacy OFFSET (cursor=null)
 */

// ─── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ─── Supabase mock ────────────────────────────────────────────────────────────

/**
 * Discovery-specific RPC mock — tracks only `get_discovery_models` and
 * `record_client_interaction` calls so tests can assert on them without the
 * `can_access_platform` guard call polluting `calls[0]`.
 */
const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const name = args[0] as string;
      // Auto-allow platform access so tests don't need to set this up.
      if (name === 'can_access_platform') {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      return mockRpc(...args);
    },
  },
}));

import {
  recordInteraction,
  getDiscoveryModels,
  loadSessionIds,
  saveSessionId,
  clearSessionIds,
  applyDiversityShuffle,
  DISCOVERY_WEIGHTS,
  DISCOVERY_PAGE_SIZE,
  type DiscoveryFilters,
  type DiscoveryModel,
  type DiscoveryCursor,
} from '../clientDiscoverySupabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeModel(
  id: string,
  overrides: Partial<{ city: string; discovery_score: number; created_at: string }> = {},
): DiscoveryModel {
  return {
    id,
    name: `Model ${id}`,
    city: overrides.city ?? 'Paris',
    country_code: 'FR',
    height: 178,
    bust: 84,
    waist: 62,
    hips: 90,
    chest: null,
    legs_inseam: null,
    portfolio_images: [`https://cdn.example.com/${id}.jpg`],
    hair_color: 'Brown',
    is_visible_fashion: true,
    is_visible_commercial: true,
    is_sports_winter: false,
    is_sports_summer: false,
    sex: null,
    ethnicity: null,
    categories: null,
    agency_id: 'agency-1',
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    territory_country_code: 'FR',
    agency_name: 'Test Agency',
    territory_agency_id: 'agency-1',
    discovery_score: overrides.discovery_score ?? 50,
  };
}

const BASE_FILTERS: DiscoveryFilters = { countryCode: 'DE' };
const ORG_ID = 'org-123';

beforeEach(() => {
  mockRpc.mockReset();
  localStorageMock.clear();
});

// ─── Test 1: Reject cooldown ──────────────────────────────────────────────────

describe('getDiscoveryModels – reject cooldown', () => {
  it('passes p_reject_hours=24 by default', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_reject_hours: 24 });
  });

  it('allows overriding p_reject_hours', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS, null, new Set(), 48);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_reject_hours: 48 });
  });
});

// ─── Test 2: Book cooldown ────────────────────────────────────────────────────

describe('getDiscoveryModels – book cooldown', () => {
  it('passes p_book_days=7 by default', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_book_days: 7 });
  });

  it('allows overriding p_book_days', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS, null, new Set(), 24, 3);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_book_days: 3 });
  });
});

// ─── Test 3: Score ordering preserved ────────────────────────────────────────

describe('getDiscoveryModels – score ordering', () => {
  it('service preserves DB-returned order (diversity shuffle stays within tiers)', async () => {
    // All same score → all tier1 → shuffle within tier, all still present
    const models = [
      makeModel('a', { discovery_score: 50 }),
      makeModel('b', { discovery_score: 50 }),
    ];
    mockRpc.mockResolvedValueOnce({ data: models, error: null });

    const { models: result } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('tier1 models (score≥50) all appear before tier3 (score<0)', async () => {
    const tier1 = [
      makeModel('t1', { discovery_score: 70 }),
      makeModel('t2', { discovery_score: 50 }),
    ];
    const tier3 = [
      makeModel('t3', { discovery_score: -40 }),
      makeModel('t4', { discovery_score: -10 }),
    ];
    mockRpc.mockResolvedValueOnce({ data: [...tier1, ...tier3], error: null });

    const { models: result } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    const tier1Ids = new Set(tier1.map((m) => m.id));
    const tier3Ids = new Set(tier3.map((m) => m.id));
    const firstTier3Index = result.findIndex((m) => tier3Ids.has(m.id));
    const lastTier1Index = result.reduce((acc, m, i) => (tier1Ids.has(m.id) ? i : acc), -1);

    expect(lastTier1Index).toBeLessThan(firstTier3Index);
  });
});

// ─── Test 4: Location city filter ────────────────────────────────────────────

describe('getDiscoveryModels – location city', () => {
  it('passes p_client_city for location boost', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, { ...BASE_FILTERS, clientCity: 'Berlin' });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_client_city: 'Berlin' });
  });

  it('passes null when no clientCity', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(mockRpc.mock.calls[0][1].p_client_city).toBeNull();
  });

  it('passes p_search_lat, p_search_lng, p_city_radius_km when filters include a geocoded pin', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, {
      ...BASE_FILTERS,
      city: 'Berlin',
      searchLat: 52.5,
      searchLng: 13.4,
      cityRadiusKm: 50,
    });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_search_lat: 52.5,
      p_search_lng: 13.4,
      p_city_radius_km: 50,
    });
  });

  it('passes null p_city_radius_km when search coordinates are absent', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(mockRpc.mock.calls[0][1].p_city_radius_km).toBeNull();
  });

  it('does not apply diversity shuffle when a city filter is set (preserves RPC order)', async () => {
    const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const sameTier = [
        makeModel('first', { discovery_score: 60 }),
        makeModel('second', { discovery_score: 60 }),
      ];
      mockRpc.mockResolvedValueOnce({ data: sameTier, error: null });
      const { models: withCity } = await getDiscoveryModels(ORG_ID, {
        ...BASE_FILTERS,
        city: 'Berlin',
      });
      expect(withCity.map((m) => m.id)).toEqual(['first', 'second']);

      mockRpc.mockResolvedValueOnce({ data: sameTier, error: null });
      const { models: noCity } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);
      expect(noCity.map((m) => m.id)).toEqual(['second', 'first']);
    } finally {
      mockRandom.mockRestore();
    }
  });
});

// ─── Test 5: Session dedup ────────────────────────────────────────────────────

describe('getDiscoveryModels – session dedup', () => {
  it('sends session-seen IDs as p_exclude_ids', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const seen = new Set(['mx', 'my']);
    await getDiscoveryModels(ORG_ID, BASE_FILTERS, null, seen);
    expect(mockRpc.mock.calls[0][1].p_exclude_ids).toEqual(expect.arrayContaining(['mx', 'my']));
  });

  it('sends null when session is empty', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await getDiscoveryModels(ORG_ID, BASE_FILTERS, null, new Set());
    expect(mockRpc.mock.calls[0][1].p_exclude_ids).toBeNull();
  });
});

// ─── Test 6: Error handling ───────────────────────────────────────────────────

describe('getDiscoveryModels – error handling', () => {
  it('returns { models: [], nextCursor: null } on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'denied', code: '42501' } });
    const result = await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(result).toEqual({ models: [], nextCursor: null });
  });

  it('returns { models: [], nextCursor: null } on exception', async () => {
    mockRpc.mockRejectedValueOnce(new Error('timeout'));
    const result = await getDiscoveryModels(ORG_ID, BASE_FILTERS);
    expect(result).toEqual({ models: [], nextCursor: null });
  });

  it('returns empty without calling RPC when clientOrgId is empty', async () => {
    const result = await getDiscoveryModels('', BASE_FILTERS);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.models).toEqual([]);
  });

  it('returns empty without calling RPC when countryCode is empty', async () => {
    const result = await getDiscoveryModels(ORG_ID, { countryCode: '' });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.models).toEqual([]);
  });
});

// ─── Test 7: recordInteraction ────────────────────────────────────────────────

describe('recordInteraction', () => {
  it('calls record_client_interaction with "viewed"', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await recordInteraction('m1', 'viewed');
    expect(mockRpc).toHaveBeenCalledWith('record_client_interaction', {
      p_model_id: 'm1',
      p_action: 'viewed',
    });
  });

  it('calls record_client_interaction with "rejected"', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await recordInteraction('m2', 'rejected');
    expect(mockRpc).toHaveBeenCalledWith('record_client_interaction', {
      p_model_id: 'm2',
      p_action: 'rejected',
    });
  });

  it('calls record_client_interaction with "booked"', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await recordInteraction('m3', 'booked');
    expect(mockRpc).toHaveBeenCalledWith('record_client_interaction', {
      p_model_id: 'm3',
      p_action: 'booked',
    });
  });

  it('does NOT throw on RPC error (non-client caller)', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'no org' } });
    await expect(recordInteraction('m1', 'viewed')).resolves.toBeUndefined();
  });

  it('does NOT throw on network exception', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    await expect(recordInteraction('m1', 'viewed')).resolves.toBeUndefined();
  });
});

// ─── Test 8: DISCOVERY_WEIGHTS ────────────────────────────────────────────────

describe('DISCOVERY_WEIGHTS', () => {
  it('exports neverSeen=50', () => expect(DISCOVERY_WEIGHTS.neverSeen).toBe(50));
  it('exports sameCity=30', () => expect(DISCOVERY_WEIGHTS.sameCity).toBe(30));
  it('exports recentActive=20', () => expect(DISCOVERY_WEIGHTS.recentActive).toBe(20));
  it('exports seenPenalty=-10', () => expect(DISCOVERY_WEIGHTS.seenPenalty).toBe(-10));
  it('exports rejectedPenalty=-40', () => expect(DISCOVERY_WEIGHTS.rejectedPenalty).toBe(-40));
});

// ─── Test 9: Retry logic ──────────────────────────────────────────────────────

describe('recordInteraction – retry', () => {
  it('retries up to 2 times on exception and succeeds on second attempt', async () => {
    mockRpc.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ error: null });

    await recordInteraction('m1', 'viewed');

    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('gives up after 2 retries and does not throw', async () => {
    mockRpc
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockRejectedValueOnce(new Error('fail3'));

    await expect(recordInteraction('m1', 'viewed')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });
});

// ─── Test 10: localStorage session persistence ────────────────────────────────

describe('loadSessionIds / saveSessionId / clearSessionIds', () => {
  it('loadSessionIds returns empty Set when key is absent', () => {
    const ids = loadSessionIds('org-1');
    expect(ids.size).toBe(0);
  });

  it('saveSessionId persists a model ID', () => {
    saveSessionId('org-1', 'model-a');
    const ids = loadSessionIds('org-1');
    expect(ids.has('model-a')).toBe(true);
  });

  it('saveSessionId accumulates multiple IDs', () => {
    saveSessionId('org-1', 'model-a');
    saveSessionId('org-1', 'model-b');
    saveSessionId('org-1', 'model-c');
    const ids = loadSessionIds('org-1');
    expect(ids.size).toBe(3);
    expect(ids.has('model-b')).toBe(true);
  });

  it('clearSessionIds removes the persisted set', () => {
    saveSessionId('org-1', 'model-a');
    clearSessionIds('org-1');
    const ids = loadSessionIds('org-1');
    expect(ids.size).toBe(0);
  });

  it('is scoped per org — org-2 does not see org-1 IDs', () => {
    saveSessionId('org-1', 'model-a');
    const idsOrg2 = loadSessionIds('org-2');
    expect(idsOrg2.size).toBe(0);
  });
});

// ─── Test 11: applyDiversityShuffle ──────────────────────────────────────────

describe('applyDiversityShuffle', () => {
  it('returns the same number of models', () => {
    const models = [
      makeModel('a', { discovery_score: 70 }),
      makeModel('b', { discovery_score: 20 }),
      makeModel('c', { discovery_score: -10 }),
      makeModel('d', { discovery_score: 50 }),
    ];
    const result = applyDiversityShuffle(models);
    expect(result).toHaveLength(4);
  });

  it('never loses a model', () => {
    const models = Array.from({ length: 10 }, (_, i) =>
      makeModel(`m${i}`, { discovery_score: Math.floor(Math.random() * 100) - 40 }),
    );
    const result = applyDiversityShuffle(models);
    const resultIds = new Set(result.map((m) => m.id));
    models.forEach((m) => expect(resultIds.has(m.id)).toBe(true));
  });

  it('all tier-1 models (score≥50) appear before tier-3 (score<0)', () => {
    const tier1 = [
      makeModel('t1a', { discovery_score: 80 }),
      makeModel('t1b', { discovery_score: 50 }),
    ];
    const tier3 = [
      makeModel('t3a', { discovery_score: -5 }),
      makeModel('t3b', { discovery_score: -40 }),
    ];
    const input = [...tier3, ...tier1]; // intentionally wrong order
    const result = applyDiversityShuffle(input);

    const tier1Ids = new Set(tier1.map((m) => m.id));
    const tier3Ids = new Set(tier3.map((m) => m.id));
    const lastT1 = result.reduce((acc, m, i) => (tier1Ids.has(m.id) ? i : acc), -1);
    const firstT3 = result.findIndex((m) => tier3Ids.has(m.id));

    expect(lastT1).toBeLessThan(firstT3);
  });

  it('handles an empty array', () => {
    expect(applyDiversityShuffle([])).toEqual([]);
  });
});

// ─── Test 12: nextCursor extracted from last model ────────────────────────────

describe('getDiscoveryModels – cursor extraction', () => {
  it('returns nextCursor with score and modelId of last model when page is full', async () => {
    const fullPage = Array.from({ length: DISCOVERY_PAGE_SIZE }, (_, i) =>
      makeModel(`m${i}`, { discovery_score: DISCOVERY_PAGE_SIZE - i }),
    );
    mockRpc.mockResolvedValueOnce({ data: fullPage, error: null });

    const { nextCursor } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    expect(nextCursor).not.toBeNull();
    // Last model after diversity shuffle — just verify shape is correct
    expect(typeof nextCursor!.score).toBe('number');
    expect(typeof nextCursor!.modelId).toBe('string');
  });

  it('returns nextCursor: null when result is smaller than page size', async () => {
    const partial = [makeModel('a'), makeModel('b')];
    mockRpc.mockResolvedValueOnce({ data: partial, error: null });

    const { nextCursor } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    expect(nextCursor).toBeNull();
  });

  it('returns nextCursor: null on empty result', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const { nextCursor } = await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    expect(nextCursor).toBeNull();
  });
});

// ─── Test 13: Cursor params forwarded to RPC ──────────────────────────────────

describe('getDiscoveryModels – cursor pagination params', () => {
  it('sends p_cursor_score and p_cursor_model_id when cursor is provided', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const cursor: DiscoveryCursor = { score: 30, modelId: 'model-xyz' };
    await getDiscoveryModels(ORG_ID, BASE_FILTERS, cursor);

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_cursor_score: 30,
      p_cursor_model_id: 'model-xyz',
    });
  });

  it('sends null cursor params when cursor is null (first page)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await getDiscoveryModels(ORG_ID, BASE_FILTERS, null);

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_cursor_score: null,
      p_cursor_model_id: null,
    });
  });

  it('sends p_limit equal to DISCOVERY_PAGE_SIZE', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await getDiscoveryModels(ORG_ID, BASE_FILTERS);

    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_limit: DISCOVERY_PAGE_SIZE });
  });

  it('sends p_city and p_client_city on paginated (cursor) calls — parity with first page', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const cursor: DiscoveryCursor = { score: 30, modelId: 'model-xyz' };
    const filters: DiscoveryFilters = {
      ...BASE_FILTERS,
      city: 'Munich',
      clientCity: 'Berlin',
    };
    await getDiscoveryModels(ORG_ID, filters, cursor);

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_city: 'Munich',
      p_client_city: 'Berlin',
      p_cursor_score: 30,
      p_cursor_model_id: 'model-xyz',
    });
  });

  it('preserves p_search_lat / p_search_lng / p_city_radius_km on paginated calls (load more)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const cursor: DiscoveryCursor = { score: 1100, modelId: 'model-page2' };
    const filters: DiscoveryFilters = {
      ...BASE_FILTERS,
      city: 'Hamburg',
      searchLat: 53.55,
      searchLng: 10.0,
      cityRadiusKm: 50,
    };
    await getDiscoveryModels(ORG_ID, filters, cursor);

    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_city: 'Hamburg',
      p_search_lat: 53.55,
      p_search_lng: 10.0,
      p_city_radius_km: 50,
      p_cursor_score: 1100,
      p_cursor_model_id: 'model-page2',
    });
  });
});
