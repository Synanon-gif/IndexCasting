import { mapSupabaseModelToClientProjectSummary } from '../clientProjectHydration';
import type { SupabaseModel } from '../../services/modelsSupabase';

function baseModel(overrides: Partial<SupabaseModel> = {}): SupabaseModel {
  return {
    id: 'model-uuid-1',
    agency_id: 'agency-1',
    user_id: null,
    email: null,
    mediaslide_sync_id: null,
    name: 'Test Model',
    height: 180,
    bust: 90,
    waist: 60,
    hips: 90,
    chest: 90,
    legs_inseam: 85,
    shoe_size: null,
    city: 'Berlin',
    country: 'DE',
    hair_color: 'Brown',
    eye_color: null,
    current_location: null,
    portfolio_images: ['raw-file.jpg'],
    polaroids: [],
    video_url: null,
    is_visible_commercial: true,
    is_visible_fashion: true,
    categories: null,
    is_sports_winter: false,
    is_sports_summer: true,
    country_code: 'DE',
    sex: 'female',
    ...overrides,
  };
}

describe('mapSupabaseModelToClientProjectSummary', () => {
  it('maps core measurements and normalizes cover URL', () => {
    const m = baseModel();
    const s = mapSupabaseModelToClientProjectSummary(m);
    expect(s.id).toBe(m.id);
    expect(s.name).toBe('Test Model');
    expect(s.city).toBe('Berlin');
    expect(s.height).toBe(180);
    expect(s.chest).toBe(90);
    expect(s.legsInseam).toBe(85);
    expect(s.coverUrl).toContain('model-uuid-1');
    expect(s.agencyId).toBe('agency-1');
    expect(s.countryCode).toBe('DE');
    expect(s.hasRealLocation).toBe(true);
    expect(s.isSportsSummer).toBe(true);
    expect(s.sex).toBe('female');
  });

  it('uses COALESCE chest from bust when chest null', () => {
    const m = baseModel({ chest: null, bust: 88 });
    const s = mapSupabaseModelToClientProjectSummary(m);
    expect(s.chest).toBe(88);
  });

  it('handles empty portfolio', () => {
    const m = baseModel({ portfolio_images: [] });
    const s = mapSupabaseModelToClientProjectSummary(m);
    expect(s.coverUrl).toBe('');
  });

  it('prefers effectiveDisplayCity over models.city', () => {
    const m = baseModel({ city: 'Berlin' });
    const s = mapSupabaseModelToClientProjectSummary(m, { effectiveDisplayCity: 'Paris' });
    expect(s.city).toBe('Paris');
  });

  it('uses effective_city on model when no override', () => {
    const m = baseModel({ city: 'Berlin', effective_city: 'Munich' });
    const s = mapSupabaseModelToClientProjectSummary(m);
    expect(s.city).toBe('Munich');
  });
});
