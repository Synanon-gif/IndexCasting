import { forwardGeocodeCityForSearch } from './forwardGeocodeCity';

const cache = new Map<string, { lat: number; lng: number } | null>();

export function citySearchGeocodeCacheKey(countryIso: string, city: string): string {
  return `${countryIso.trim().toUpperCase()}|${city.trim().toLowerCase()}`;
}

/**
 * Cached forward-geocode for client city filter + discovery load-more (same pin per session key).
 */
export async function getCitySearchGeocodedPin(
  countryIso: string,
  city: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = citySearchGeocodeCacheKey(countryIso, city);
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }
  const pin = await forwardGeocodeCityForSearch(city, countryIso);
  cache.set(key, pin);
  return pin;
}

/** For tests / filter reset */
export function clearCitySearchGeocodeCache(): void {
  cache.clear();
}
