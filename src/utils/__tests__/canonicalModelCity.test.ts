import { canonicalDisplayCityForModel } from '../canonicalModelCity';

describe('canonicalDisplayCityForModel', () => {
  it('prefers effective_city over location_city and city', () => {
    expect(
      canonicalDisplayCityForModel({
        effective_city: ' Munich ',
        location_city: 'Berlin',
        city: 'Hamburg',
      }),
    ).toBe('Munich');
  });

  it('falls back to location_city then city', () => {
    expect(
      canonicalDisplayCityForModel({
        effective_city: null,
        location_city: 'Berlin',
        city: 'Hamburg',
      }),
    ).toBe('Berlin');
    expect(canonicalDisplayCityForModel({ city: 'Hamburg' })).toBe('Hamburg');
  });

  it('returns empty when all missing', () => {
    expect(canonicalDisplayCityForModel({})).toBe('');
  });
});
