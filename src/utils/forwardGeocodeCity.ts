import { roundCoord } from '../services/modelLocationsSupabase';

/**
 * Forward-geocode city + ISO-2 country for discovery / roster city proximity.
 * Returns privacy-rounded coordinates (~5 km), or null if Nominatim finds nothing.
 */
export async function forwardGeocodeCityForSearch(
  city: string,
  countryIso2: string,
): Promise<{ lat: number; lng: number } | null> {
  const c = city.trim();
  const iso = countryIso2.trim().toUpperCase();
  if (!c || !iso) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(c)},${encodeURIComponent(iso)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } },
    );
    const results = (await res.json()) as Array<{ lat: string; lon: string }>;
    const first = results[0];
    if (!first) return null;
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: roundCoord(lat), lng: roundCoord(lng) };
  } catch (e) {
    console.warn('[forwardGeocodeCityForSearch] failed:', e);
    return null;
  }
}
