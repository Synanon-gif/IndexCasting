import { filterModels, defaultModelFilters, type ModelFilters } from '../modelFilters';
import type { SupabaseModel } from '../../services/modelsSupabase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<SupabaseModel>): SupabaseModel {
  return {
    id: 'test-id',
    agency_id: 'agency-1',
    user_id: null,
    name: 'Test Model',
    email: null,
    mediaslide_sync_id: null,
    height: 175,
    bust: null,
    waist: 65,
    hips: 90,
    chest: 85,
    legs_inseam: 80,
    shoe_size: null,
    city: 'Berlin',
    country: 'Germany',
    country_code: 'DE',
    hair_color: 'Brown',
    eye_color: 'Blue',
    current_location: null,
    portfolio_images: [],
    polaroids: [],
    video_url: null,
    is_visible_commercial: true,
    is_visible_fashion: true,
    categories: null,
    is_sports_winter: false,
    is_sports_summer: false,
    ...overrides,
  };
}

const noFilter: ModelFilters = { ...defaultModelFilters };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('filterModels', () => {
  describe('no active filters', () => {
    it('returns all models when no filter is active', () => {
      const models = [makeModel({ id: '1' }), makeModel({ id: '2' }), makeModel({ id: '3' })];
      expect(filterModels(models, noFilter)).toHaveLength(3);
    });

    it('returns empty array when model list is empty', () => {
      expect(filterModels([], noFilter)).toHaveLength(0);
    });
  });

  describe('height (numeric range)', () => {
    const short = makeModel({ id: 'short', height: 170 });
    const medium = makeModel({ id: 'medium', height: 178 });
    const tall = makeModel({ id: 'tall', height: 185 });
    const models = [short, medium, tall];

    it('no height filter returns all models', () => {
      expect(filterModels(models, { ...noFilter, heightMin: '', heightMax: '' })).toHaveLength(3);
    });

    it('heightMax=174 returns only models at or below 174', () => {
      const result = filterModels(models, { ...noFilter, heightMax: '174' });
      expect(result.map((m) => m.id)).toEqual(['short']);
    });

    it('heightMin=175 heightMax=182 returns only models in 175–182', () => {
      const result = filterModels(models, { ...noFilter, heightMin: '175', heightMax: '182' });
      expect(result.map((m) => m.id)).toEqual(['medium']);
    });

    it('heightMin=183 returns only models at or above 183', () => {
      const result = filterModels(models, { ...noFilter, heightMin: '183' });
      expect(result.map((m) => m.id)).toEqual(['tall']);
    });

    it('boundary: heightMax=174 excludes height=175', () => {
      expect(filterModels([makeModel({ height: 174 })], { ...noFilter, heightMax: '174' })).toHaveLength(1);
      expect(filterModels([makeModel({ height: 175 })], { ...noFilter, heightMax: '174' })).toHaveLength(0);
    });

    it('boundary: heightMin=175 excludes height=174', () => {
      expect(filterModels([makeModel({ height: 175 })], { ...noFilter, heightMin: '175' })).toHaveLength(1);
      expect(filterModels([makeModel({ height: 174 })], { ...noFilter, heightMin: '175' })).toHaveLength(0);
    });

    it('boundary: heightMin=183 excludes height=182', () => {
      expect(filterModels([makeModel({ height: 183 })], { ...noFilter, heightMin: '183' })).toHaveLength(1);
      expect(filterModels([makeModel({ height: 182 })], { ...noFilter, heightMin: '183' })).toHaveLength(0);
    });
  });

  describe('hair color', () => {
    const brown = makeModel({ id: 'brown', hair_color: 'Brown' });
    const blonde = makeModel({ id: 'blonde', hair_color: 'Blonde' });
    const noHair = makeModel({ id: 'nohair', hair_color: null });
    const models = [brown, blonde, noHair];

    it('matches exact hair color (case-insensitive)', () => {
      const result = filterModels(models, { ...noFilter, hairColor: 'brown' });
      expect(result.map((m) => m.id)).toEqual(['brown']);
    });

    it('matches partial hair color', () => {
      const result = filterModels(models, { ...noFilter, hairColor: 'lond' });
      expect(result.map((m) => m.id)).toEqual(['blonde']);
    });

    it('excludes models with null hair_color when filter active', () => {
      const result = filterModels(models, { ...noFilter, hairColor: 'brown' });
      expect(result.map((m) => m.id)).not.toContain('nohair');
    });

    it('empty hairColor includes all', () => {
      expect(filterModels(models, { ...noFilter, hairColor: '' })).toHaveLength(3);
    });
  });

  describe('measurements', () => {
    const modelA = makeModel({ id: 'A', hips: 85, waist: 60, chest: 80, legs_inseam: 75 });
    const modelB = makeModel({ id: 'B', hips: 95, waist: 70, chest: 90, legs_inseam: 85 });
    const models = [modelA, modelB];

    it('filters by hipsMin', () => {
      expect(filterModels(models, { ...noFilter, hipsMin: '90' }).map((m) => m.id)).toEqual(['B']);
    });

    it('filters by hipsMax', () => {
      expect(filterModels(models, { ...noFilter, hipsMax: '90' }).map((m) => m.id)).toEqual(['A']);
    });

    it('filters by waistMin and waistMax range', () => {
      expect(filterModels(models, { ...noFilter, waistMin: '62', waistMax: '72' }).map((m) => m.id)).toEqual(['B']);
    });

    it('filters by chestMin', () => {
      expect(filterModels(models, { ...noFilter, chestMin: '85' }).map((m) => m.id)).toEqual(['B']);
    });

    it('filters by chestMax', () => {
      expect(filterModels(models, { ...noFilter, chestMax: '85' }).map((m) => m.id)).toEqual(['A']);
    });

    it('uses bust as fallback when chest is null (Agency roster / package builder parity)', () => {
      const legacy = [
        makeModel({ id: 'legacy', chest: null, bust: 88, hips: 90, waist: 60, legs_inseam: 80 }),
      ];
      expect(filterModels(legacy, { ...noFilter, chestMin: '85', chestMax: '90' }).map((m) => m.id)).toEqual([
        'legacy',
      ]);
    });

    it('filters by legsInseamMin', () => {
      expect(filterModels(models, { ...noFilter, legsInseamMin: '80' }).map((m) => m.id)).toEqual(['B']);
    });

    it('filters by legsInseamMax', () => {
      expect(filterModels(models, { ...noFilter, legsInseamMax: '80' }).map((m) => m.id)).toEqual(['A']);
    });

    it('excludes models with null measurement when min/max filter active', () => {
      const nullHips = makeModel({ id: 'null-hips', hips: null });
      expect(filterModels([nullHips], { ...noFilter, hipsMin: '80' })).toHaveLength(0);
    });
  });

  describe('category', () => {
    const fashionOnly = makeModel({ id: 'fashion', is_visible_fashion: true, is_visible_commercial: false, categories: ['Fashion'] });
    const highFashion = makeModel({ id: 'highfashion', is_visible_fashion: true, is_visible_commercial: false, categories: ['High Fashion'] });
    const commercial = makeModel({ id: 'commercial', is_visible_fashion: false, is_visible_commercial: true, categories: ['Commercial'] });
    const both = makeModel({ id: 'both', is_visible_fashion: true, is_visible_commercial: true, categories: ['Fashion', 'Commercial'] });
    const models = [fashionOnly, highFashion, commercial, both];

    it('category="" returns all models', () => {
      expect(filterModels(models, { ...noFilter, category: '' })).toHaveLength(4);
    });

    it('category=Fashion returns fashion-visible models (includes High Fashion)', () => {
      const result = filterModels(models, { ...noFilter, category: 'Fashion' });
      expect(result.map((m) => m.id).sort()).toEqual(['both', 'fashion', 'highfashion']);
    });

    it('category=High Fashion returns only models with High Fashion in categories', () => {
      const result = filterModels(models, { ...noFilter, category: 'High Fashion' });
      expect(result.map((m) => m.id)).toEqual(['highfashion']);
    });

    it('category=Commercial returns only commercial-visible models', () => {
      const result = filterModels(models, { ...noFilter, category: 'Commercial' });
      expect(result.map((m) => m.id).sort()).toEqual(['both', 'commercial']);
    });
  });

  describe('sports', () => {
    const winterModel = makeModel({ id: 'winter', is_sports_winter: true, is_sports_summer: false });
    const summerModel = makeModel({ id: 'summer', is_sports_winter: false, is_sports_summer: true });
    const bothSports = makeModel({ id: 'both', is_sports_winter: true, is_sports_summer: true });
    const noSports = makeModel({ id: 'none', is_sports_winter: false, is_sports_summer: false });
    const models = [winterModel, summerModel, bothSports, noSports];

    it('sportsWinter=true filters to winter models', () => {
      const result = filterModels(models, { ...noFilter, sportsWinter: true });
      expect(result.map((m) => m.id).sort()).toEqual(['both', 'winter']);
    });

    it('sportsSummer=true filters to summer models', () => {
      const result = filterModels(models, { ...noFilter, sportsSummer: true });
      expect(result.map((m) => m.id).sort()).toEqual(['both', 'summer']);
    });

    it('both sportsWinter and sportsSummer returns only models with both', () => {
      const result = filterModels(models, { ...noFilter, sportsWinter: true, sportsSummer: true });
      expect(result.map((m) => m.id)).toEqual(['both']);
    });
  });

  describe('combined filters', () => {
    it('applies multiple filters simultaneously', () => {
      const models = [
        makeModel({ id: 'match', height: 178, hair_color: 'Brown', hips: 88, is_visible_fashion: true }),
        makeModel({ id: 'wrong-height', height: 185, hair_color: 'Brown', hips: 88, is_visible_fashion: true }),
        makeModel({ id: 'wrong-hair', height: 178, hair_color: 'Blonde', hips: 88, is_visible_fashion: true }),
        makeModel({ id: 'wrong-hips', height: 178, hair_color: 'Brown', hips: 100, is_visible_fashion: true }),
      ];
      const result = filterModels(models, {
        ...noFilter,
        heightMin: '175',
        heightMax: '182',
        hairColor: 'Brown',
        hipsMax: '90',
        category: 'Fashion',
      });
      expect(result.map((m) => m.id)).toEqual(['match']);
    });
  });

  describe('sex filter', () => {
    const female = makeModel({ id: 'female', sex: 'female' });
    const male = makeModel({ id: 'male', sex: 'male' });
    const unset = makeModel({ id: 'unset', sex: undefined });
    const models = [female, male, unset];

    it('sex=all returns all models', () => {
      expect(filterModels(models, { ...noFilter, sex: 'all' })).toHaveLength(3);
    });

    it('sex=female returns only female models', () => {
      const result = filterModels(models, { ...noFilter, sex: 'female' });
      expect(result.map((m) => m.id)).toEqual(['female']);
    });

    it('sex=male returns only male models', () => {
      const result = filterModels(models, { ...noFilter, sex: 'male' });
      expect(result.map((m) => m.id)).toEqual(['male']);
    });

    it('sex=female excludes models with no sex set', () => {
      expect(filterModels([unset], { ...noFilter, sex: 'female' })).toHaveLength(0);
    });

    it('sex=male excludes models with no sex set', () => {
      expect(filterModels([unset], { ...noFilter, sex: 'male' })).toHaveLength(0);
    });
  });

  describe('nearby filter', () => {
    const berlin = makeModel({ id: 'berlin', city: 'Berlin' });
    const munich = makeModel({ id: 'munich', city: 'Munich' });
    const models = [berlin, munich];

    it('nearby=true with userCity filters by city substring', () => {
      const result = filterModels(models, { ...noFilter, nearby: true }, 'Berlin');
      expect(result.map((m) => m.id)).toEqual(['berlin']);
    });

    it('nearby=true without userCity returns all models', () => {
      expect(filterModels(models, { ...noFilter, nearby: true }, undefined)).toHaveLength(2);
    });
  });

  describe('ethnicity filter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asian = makeModel({ id: 'asian', ethnicity: 'East Asian' } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const black = makeModel({ id: 'black', ethnicity: 'Black / African' } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noEthnicity = makeModel({ id: 'none', ethnicity: undefined } as any);
    const models = [asian, black, noEthnicity];

    it('ethnicities=[] returns all models', () => {
      expect(filterModels(models, { ...noFilter, ethnicities: [] })).toHaveLength(3);
    });

    it('single ethnicity selection filters correctly', () => {
      const result = filterModels(models, { ...noFilter, ethnicities: ['East Asian'] });
      expect(result.map((m) => m.id)).toEqual(['asian']);
    });

    it('multi-select returns all matching ethnicities', () => {
      const result = filterModels(models, { ...noFilter, ethnicities: ['East Asian', 'Black / African'] });
      expect(result.map((m) => m.id)).toEqual(['asian', 'black']);
    });

    it('excludes model with no ethnicity set when filter is active', () => {
      const result = filterModels(models, { ...noFilter, ethnicities: ['East Asian'] });
      expect(result.map((m) => m.id)).not.toContain('none');
    });
  });
});
