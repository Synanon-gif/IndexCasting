/**
 * Reverse geocode privacy-rounded coordinates (already ~5 km grid via roundCoord).
 * Uses Nominatim with mandatory User-Agent — required by OSM usage policy.
 */
export const NOMINATIM_INDEXCASTING_HEADERS: Record<string, string> = {
  'Accept-Language': 'en',
  'User-Agent': 'IndexCasting/1.0',
};

export type ReverseGeocodeApproxResult = {
  city: string;
  /** ISO 3166-1 alpha-2 uppercased, or null if Nominatim omitted it */
  countryCodeIso2: string | null;
};

/**
 * Resolve city + optional country from rounded lat/lng. Returns null when HTTP fails,
 * body is unusable, or city cannot be determined (caller should show an error — do not silently save placeholders).
 */
export async function reverseGeocodeRoundedCoords(
  latRounded: number,
  lngRounded: number,
): Promise<ReverseGeocodeApproxResult | null> {
  if (!Number.isFinite(latRounded) || !Number.isFinite(lngRounded)) return null;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latRounded}&lon=${lngRounded}&format=json`,
      { headers: NOMINATIM_INDEXCASTING_HEADERS },
    );
    if (!res.ok) {
      console.warn('[reverseGeocodeRoundedCoords] nominatim HTTP status:', res.status);
      return null;
    }

    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        country_code?: string;
      };
    };

    const rawCity =
      data.address?.city ??
      data.address?.town ??
      data.address?.village ??
      data.address?.state ??
      null;
    const city = typeof rawCity === 'string' ? rawCity.trim() : '';
    if (!city) return null;

    const ccRaw = data.address?.country_code;
    const cc = typeof ccRaw === 'string' ? ccRaw.trim().toUpperCase().slice(0, 2) : null;
    const countryCodeIso2 = cc && cc.length === 2 ? cc : null;

    return { city, countryCodeIso2 };
  } catch (e) {
    console.warn('[reverseGeocodeRoundedCoords] request failed:', e);
    return null;
  }
}
