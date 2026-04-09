/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for apiService.js — central data-access layer.
 *
 * Security invariants verified:
 *  1. portfolio.polaroids is ALWAYS [] — discovery never leaks polaroids
 *  2. getModelsForClient / getAgencyModels map polaroids: [] defensively
 *  3. calendar defaults are empty arrays (no hardcoded dates in production data)
 */

// ─── Mock modelsSupabase ───────────────────────────────────────────────────────
const mockGetModelById = jest.fn();
const mockGetModelsForClient = jest.fn();
const mockGetModelsForClientByTerritory = jest.fn();
const mockGetModelsForClientHybrid = jest.fn();
const mockGetModelsForAgency = jest.fn();
const mockGetModels = jest.fn();
const mockUpdateModelVisibility = jest.fn();

jest.mock('../modelsSupabase', () => ({
  getModelByIdFromSupabase: (...args: unknown[]) => mockGetModelById(...args),
  getModelsForClientFromSupabase: (...args: unknown[]) => mockGetModelsForClient(...args),
  getModelsForClientFromSupabaseByTerritory: (...args: unknown[]) => mockGetModelsForClientByTerritory(...args),
  getModelsForClientFromSupabaseHybridLocation: (...args: unknown[]) => mockGetModelsForClientHybrid(...args),
  getModelsForAgencyFromSupabase: (...args: unknown[]) => mockGetModelsForAgency(...args),
  getModelsFromSupabase: (...args: unknown[]) => mockGetModels(...args),
  updateModelVisibilityInSupabase: (...args: unknown[]) => mockUpdateModelVisibility(...args),
}));

import {
  getModelData,
  updateAvailability,
  getModelsForClient,
  getAgencyModels,
  updateModelVisibility,
} from '../apiService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBaseModel(overrides = {}) {
  return {
    id: 'model-1',
    name: 'Anna Müller',
    height: 178,
    bust: 84,
    waist: 62,
    hips: 90,
    portfolio_images: ['https://cdn.example.com/p1.jpg', 'https://cdn.example.com/p2.jpg'],
    is_visible_commercial: true,
    is_visible_fashion: true,
    ...overrides,
  };
}

// ─── getModelData ──────────────────────────────────────────────────────────────

describe('getModelData', () => {
  beforeEach(() => {
    mockGetModelById.mockReset();
    // Reset the module-level availabilityOverrides map between tests by calling
    // updateAvailability with an empty record for the tested id.
  });

  it('returns null when model does not exist', async () => {
    mockGetModelById.mockResolvedValue(null);
    const result = await getModelData('nonexistent');
    expect(result).toBeNull();
  });

  it('maps measurements correctly (chest coalesces legacy bust)', async () => {
    mockGetModelById.mockResolvedValue(makeBaseModel());
    const result = (await getModelData('model-1')) as any;
    expect(result.measurements).toEqual({ height: 178, chest: 84, waist: 62, hips: 90 });
    expect(result.id).toBe('model-1');
    expect(result.name).toBe('Anna Müller');
  });

  it('prefers chest over bust when both are set', async () => {
    mockGetModelById.mockResolvedValue(makeBaseModel({ chest: 90, bust: 84 }));
    const result = (await getModelData('model-1')) as any;
    expect(result.measurements.chest).toBe(90);
  });

  it('SECURITY: portfolio.polaroids is always [] — discovery never leaks polaroids', async () => {
    mockGetModelById.mockResolvedValue(makeBaseModel());
    const result = (await getModelData('model-1')) as any;
    expect(result.portfolio.polaroids).toEqual([]);
    // Even if the DB row somehow had a polaroids field, it must not be forwarded.
  });

  it('maps portfolio_images from DB into portfolio.images', async () => {
    mockGetModelById.mockResolvedValue(
      makeBaseModel({ portfolio_images: ['https://cdn.example.com/img1.jpg'] }),
    );
    const result = (await getModelData('model-1')) as any;
    expect(result.portfolio.images).toEqual(['https://cdn.example.com/img1.jpg']);
  });

  it('normalizes bare portfolio filenames to canonical storage URIs', async () => {
    mockGetModelById.mockResolvedValue(
      makeBaseModel({
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        portfolio_images: ['1775722024203-qb@yh9zy.jpg'],
      }),
    );
    const result = (await getModelData('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')) as any;
    expect(result.portfolio.images[0]).toContain('supabase-storage://documentspictures/');
    expect(result.portfolio.images[0]).toContain(
      'model-photos/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1775722024203-qb@yh9zy.jpg',
    );
  });

  it('falls back to empty array when portfolio_images is null', async () => {
    mockGetModelById.mockResolvedValue(makeBaseModel({ portfolio_images: null }));
    const result = (await getModelData('model-1')) as any;
    expect(result.portfolio.images).toEqual([]);
  });

  it('SECURITY: default calendar has no hardcoded dates — blocked and available are []', async () => {
    mockGetModelById.mockResolvedValue(makeBaseModel());
    // Make sure there is no cached override from a previous test by using a fresh id.
    const result = (await getModelData('model-no-override')) as any;
    expect(result.calendar.blocked).toEqual([]);
    expect(result.calendar.available).toEqual([]);
  });

  it('applies updateAvailability overrides correctly', async () => {
    const testId = 'model-override';
    mockGetModelById.mockResolvedValue(makeBaseModel({ id: testId }));

    await updateAvailability(testId, {
      blocked: ['2026-04-01', '2026-04-02'],
      available: ['2026-04-03'],
    });

    const result = (await getModelData(testId)) as any;
    expect(result.calendar.blocked).toEqual(['2026-04-01', '2026-04-02']);
    expect(result.calendar.available).toEqual(['2026-04-03']);
  });

  it('maps isVisibleCommercial and isVisibleFashion', async () => {
    mockGetModelById.mockResolvedValue(
      makeBaseModel({ is_visible_commercial: false, is_visible_fashion: true }),
    );
    const result = (await getModelData('model-1')) as any;
    expect(result.isVisibleCommercial).toBe(false);
    expect(result.isVisibleFashion).toBe(true);
  });
});

// ─── updateAvailability ────────────────────────────────────────────────────────

describe('updateAvailability', () => {
  it('stores and retrieves blocked/available dates via getModelData', async () => {
    const id = 'avail-test-model';
    mockGetModelById.mockResolvedValue(makeBaseModel({ id }));

    await updateAvailability(id, { blocked: ['2026-05-10'], available: ['2026-05-11'] });
    const result = (await getModelData(id)) as any;

    expect(result.calendar.blocked).toEqual(['2026-05-10']);
    expect(result.calendar.available).toEqual(['2026-05-11']);
  });

  it('overwrites a previous override', async () => {
    const id = 'avail-overwrite-model';
    mockGetModelById.mockResolvedValue(makeBaseModel({ id }));

    await updateAvailability(id, { blocked: ['2026-06-01'], available: [] });
    await updateAvailability(id, { blocked: ['2026-07-01'], available: ['2026-07-02'] });

    const result = (await getModelData(id)) as any;
    expect(result.calendar.blocked).toEqual(['2026-07-01']);
    expect(result.calendar.available).toEqual(['2026-07-02']);
  });

  it('accepts empty arrays without throwing', async () => {
    await expect(
      updateAvailability('model-empty', { blocked: [], available: [] }),
    ).resolves.not.toThrow();
  });
});

// ─── getModelsForClient ────────────────────────────────────────────────────────

describe('getModelsForClient', () => {
  beforeEach(() => {
    mockGetModelsForClient.mockReset();
    mockGetModelsForClientHybrid.mockReset();
  });

  const dbRow = {
    id: 'm1', name: 'Lena', city: 'Berlin', hair_color: 'Brown',
    height: 175, bust: 82, chest: null, waist: 60, hips: 88, legs_inseam: null,
    portfolio_images: ['https://cdn.example.com/lena.jpg'],
    is_visible_commercial: true, is_visible_fashion: true,
    categories: null, is_sports_winter: false, is_sports_summer: false,
    sex: 'female', agency_id: 'agency-1', agency_name: 'Top Models',
    has_real_location: false, country_code: null, territory_country_code: 'DE',
    territory_agency_id: null,
  };

  it('SECURITY: mapped result always has polaroids: []', async () => {
    mockGetModelsForClient.mockResolvedValue([dbRow]);
    const result = (await getModelsForClient('fashion')) as any[];
    expect(result[0].polaroids).toEqual([]);
  });

  it('maps gallery from portfolio_images', async () => {
    mockGetModelsForClient.mockResolvedValue([dbRow]);
    const result = (await getModelsForClient('fashion')) as any[];
    expect(result[0].gallery).toEqual(['https://cdn.example.com/lena.jpg']);
  });

  it('maps chest from bust when chest column is null (legacy rows)', async () => {
    mockGetModelsForClient.mockResolvedValue([dbRow]);
    const result = (await getModelsForClient('fashion')) as any[];
    expect(result[0].chest).toBe(82);
  });

  it('uses hybrid-location endpoint when countryCode provided', async () => {
    mockGetModelsForClientHybrid.mockResolvedValue([dbRow]);
    await getModelsForClient('fashion', 'DE', 'Berlin');
    expect(mockGetModelsForClientHybrid).toHaveBeenCalled();
    expect(mockGetModelsForClient).not.toHaveBeenCalled();
  });

  it('returns empty array when no models found', async () => {
    mockGetModelsForClient.mockResolvedValue([]);
    const result = await getModelsForClient('all');
    expect(result).toEqual([]);
  });
});

// ─── getAgencyModels ───────────────────────────────────────────────────────────

describe('getAgencyModels', () => {
  beforeEach(() => {
    mockGetModelsForAgency.mockReset();
    mockGetModels.mockReset();
  });

  const agencyRow = {
    id: 'model-a', name: 'Max', is_visible_commercial: true, is_visible_fashion: false,
  };

  it('calls getModelsForAgencyFromSupabase when agencyId is provided', async () => {
    mockGetModelsForAgency.mockResolvedValue([agencyRow]);
    const result = (await getAgencyModels('agency-1')) as any[];
    expect(mockGetModelsForAgency).toHaveBeenCalledWith('agency-1');
    expect(result[0].traction).toBe(0);
  });

  it('calls getModelsFromSupabase when no agencyId given', async () => {
    mockGetModels.mockResolvedValue([agencyRow]);
    await getAgencyModels(undefined);
    expect(mockGetModels).toHaveBeenCalled();
  });

  it('maps isVisibleCommercial / isVisibleFashion correctly', async () => {
    mockGetModelsForAgency.mockResolvedValue([
      { ...agencyRow, is_visible_commercial: false, is_visible_fashion: true },
    ]);
    const result = (await getAgencyModels('agency-1')) as any[];
    expect(result[0].isVisibleCommercial).toBe(false);
    expect(result[0].isVisibleFashion).toBe(true);
  });
});

// ─── updateModelVisibility ────────────────────────────────────────────────────

describe('updateModelVisibility', () => {
  beforeEach(() => mockUpdateModelVisibility.mockReset());

  it('delegates to updateModelVisibilityInSupabase with snake_case fields', async () => {
    mockUpdateModelVisibility.mockResolvedValue(undefined);
    await updateModelVisibility('model-1', { isVisibleCommercial: false, isVisibleFashion: true });
    expect(mockUpdateModelVisibility).toHaveBeenCalledWith('model-1', {
      is_visible_commercial: false,
      is_visible_fashion: true,
    });
  });

  it('defaults null values to true (defensive)', async () => {
    mockUpdateModelVisibility.mockResolvedValue(undefined);
    await updateModelVisibility('model-1', {
      isVisibleCommercial: null as any,
      isVisibleFashion: null as any,
    });
    expect(mockUpdateModelVisibility).toHaveBeenCalledWith('model-1', {
      is_visible_commercial: true,
      is_visible_fashion: true,
    });
  });
});
