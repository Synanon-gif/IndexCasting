/**
 * Shared model filter types, defaults, and client-side filtering logic.
 * Used by both the Client Discover view (server-side fetch params) and the
 * Agency My Models view (client-side filtering on already-fetched models).
 */
import type { SupabaseModel } from '../services/modelsSupabase';
import type { ModelApplication } from '../store/applicationsStore';

// ── Type ──────────────────────────────────────────────────────────────────────

export type ModelFilters = {
  /** Biological sex filter: 'all' = no restriction. */
  sex: 'all' | 'male' | 'female';
  /** Numeric height range in cm; empty string = no restriction. */
  heightMin: string;
  heightMax: string;
  /** Multi-select ethnicity filter; empty array = no restriction (show all). */
  ethnicities: string[];
  /** ISO-2 country code, '' = all countries */
  countryCode: string;
  /** Free-text city substring, '' = all cities */
  city: string;
  /** Filter by user's detected city */
  nearby: boolean;
  hairColor: string;
  hipsMin: string;
  hipsMax: string;
  waistMin: string;
  waistMax: string;
  chestMin: string;
  chestMax: string;
  legsInseamMin: string;
  legsInseamMax: string;
  /** Marketing category: '' = all, 'Fashion' | 'High Fashion' | 'Commercial' */
  category: string;
  /** Sports filters — independent multi-select, both can be true simultaneously. */
  sportsWinter: boolean;
  sportsSummer: boolean;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const defaultModelFilters: ModelFilters = {
  sex: 'all',
  heightMin: '',
  heightMax: '',
  ethnicities: [],
  countryCode: '',
  city: '',
  nearby: false,
  hairColor: '',
  hipsMin: '',
  hipsMax: '',
  waistMin: '',
  waistMax: '',
  chestMin: '',
  chestMax: '',
  legsInseamMin: '',
  legsInseamMax: '',
  category: '',
  sportsWinter: false,
  sportsSummer: false,
};

// ── Country list ──────────────────────────────────────────────────────────────

/** All selectable countries for the country search dropdown. Sorted A→Z. */
export const FILTER_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: 'AL', label: 'Albania' },
  { code: 'DZ', label: 'Algeria' },
  { code: 'AR', label: 'Argentina' },
  { code: 'AU', label: 'Australia' },
  { code: 'AT', label: 'Austria' },
  { code: 'BE', label: 'Belgium' },
  { code: 'BA', label: 'Bosnia & Herzegovina' },
  { code: 'BR', label: 'Brazil' },
  { code: 'BG', label: 'Bulgaria' },
  { code: 'CA', label: 'Canada' },
  { code: 'CL', label: 'Chile' },
  { code: 'CN', label: 'China' },
  { code: 'CO', label: 'Colombia' },
  { code: 'HR', label: 'Croatia' },
  { code: 'CY', label: 'Cyprus' },
  { code: 'CZ', label: 'Czech Republic' },
  { code: 'DK', label: 'Denmark' },
  { code: 'EG', label: 'Egypt' },
  { code: 'EE', label: 'Estonia' },
  { code: 'FI', label: 'Finland' },
  { code: 'FR', label: 'France' },
  { code: 'DE', label: 'Germany' },
  { code: 'GH', label: 'Ghana' },
  { code: 'GR', label: 'Greece' },
  { code: 'HU', label: 'Hungary' },
  { code: 'IS', label: 'Iceland' },
  { code: 'IN', label: 'India' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'IE', label: 'Ireland' },
  { code: 'IL', label: 'Israel' },
  { code: 'IT', label: 'Italy' },
  { code: 'JP', label: 'Japan' },
  { code: 'KE', label: 'Kenya' },
  { code: 'KR', label: 'South Korea' },
  { code: 'LV', label: 'Latvia' },
  { code: 'LT', label: 'Lithuania' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'MA', label: 'Morocco' },
  { code: 'MX', label: 'Mexico' },
  { code: 'ME', label: 'Montenegro' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'MK', label: 'North Macedonia' },
  { code: 'NO', label: 'Norway' },
  { code: 'PK', label: 'Pakistan' },
  { code: 'PE', label: 'Peru' },
  { code: 'PH', label: 'Philippines' },
  { code: 'PL', label: 'Poland' },
  { code: 'PT', label: 'Portugal' },
  { code: 'RO', label: 'Romania' },
  { code: 'RU', label: 'Russia' },
  { code: 'RS', label: 'Serbia' },
  { code: 'SG', label: 'Singapore' },
  { code: 'SK', label: 'Slovakia' },
  { code: 'SI', label: 'Slovenia' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'ES', label: 'Spain' },
  { code: 'SE', label: 'Sweden' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'TW', label: 'Taiwan' },
  { code: 'TH', label: 'Thailand' },
  { code: 'TR', label: 'Turkey' },
  { code: 'UA', label: 'Ukraine' },
  { code: 'AE', label: 'UAE' },
  { code: 'GB', label: 'UK' },
  { code: 'US', label: 'USA' },
  { code: 'UY', label: 'Uruguay' },
  { code: 'VN', label: 'Vietnam' },
];

// ── Hair & Eye color options ──────────────────────────────────────────────────

/** Predefined hair colour options — used in model edit panel and filter pill selector. */
export const HAIR_COLOR_OPTIONS: string[] = [
  'Black',
  'Brown',
  'Dark Brown',
  'Auburn',
  'Blonde',
  'Platinum Blonde',
  'Red',
  'Grey',
  'Silver',
  'White',
  'Other',
];

/** Predefined eye colour options — used in model edit panel pill selector. */
export const EYE_COLOR_OPTIONS: string[] = [
  'Brown',
  'Blue',
  'Green',
  'Grey',
  'Hazel',
  'Amber',
  'Other',
];

// ── Ethnicity options ─────────────────────────────────────────────────────────

/** Broad ethnicity groups shown in the multi-select filter. Max 20, industry-standard. */
export const ETHNICITY_OPTIONS: string[] = [
  'White / Caucasian',
  'Black / African',
  'Black / African American',
  'East Asian',
  'South Asian',
  'Southeast Asian',
  'Hispanic / Latina/o',
  'Middle Eastern',
  'North African',
  'Mixed / Multiracial',
  'Pacific Islander',
  'Indigenous / Native',
  'Caribbean',
  'Central Asian',
  'Other',
];

// ── Haversine distance ────────────────────────────────────────────────────────

/**
 * Calculates the great-circle distance between two coordinates using the
 * Haversine formula. Returns the distance in kilometres.
 *
 * Used for client-side "Near me" filtering in Agency My Models view
 * (where models are already fetched and have model_location attached).
 * For the Client Discover view the distance calculation runs server-side
 * inside the get_models_near_location RPC.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Client-side filter function ───────────────────────────────────────────────

/**
 * Applies all ModelFilters to an already-fetched list of SupabaseModel objects.
 * Mirrors the server-side logic in modelsSupabase.ts / applyMeasurementFilters.
 *
 * Used by: Agency My Models (all own models already loaded).
 * Not used by: Client Discover (uses server-side Supabase params instead).
 *
 * @param models   - Full model list, already fetched from Supabase.
 * @param filters  - Active filter state.
 * @param userCity - Detected city for "Near me" fallback (optional).
 * @param userLat  - Rounded client latitude for radius-based Near me (optional).
 * @param userLng  - Rounded client longitude for radius-based Near me (optional).
 * @param nearMeRadiusKm - Radius in km for "Near me" filter (default 50).
 */
export function filterModels(
  models: (SupabaseModel & { model_location?: { lat_approx?: number | null; lng_approx?: number | null } | null })[],
  filters: ModelFilters,
  userCity?: string,
  userLat?: number | null,
  userLng?: number | null,
  nearMeRadiusKm: number = 50,
): SupabaseModel[] {
  const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };

  return models.filter((m) => {
    // ── Sex ──
    if (filters.sex === 'male'   && m.sex !== 'male')   return false;
    if (filters.sex === 'female' && m.sex !== 'female') return false;

    // ── Height (numeric range) ──
    const hMin = pInt(filters.heightMin);
    const hMax = pInt(filters.heightMax);
    if (hMin !== undefined && (m.height == null || m.height < hMin)) return false;
    if (hMax !== undefined && (m.height == null || m.height > hMax)) return false;

    // ── Country (ISO-2 code) ──
    if (filters.countryCode) {
      // Only filter if model has a country_code set; older records may be null.
      if (m.country_code && m.country_code.toUpperCase() !== filters.countryCode.toUpperCase()) return false;
    }

    // ── City (substring) — only when a country is also selected ──
    if (filters.countryCode && filters.city.trim()) {
      const cityQ = filters.city.trim().toLowerCase();
      if (!(m.city || '').toLowerCase().includes(cityQ)) return false;
    }

    // ── Nearby ──
    // Priority 1: radius-based using model_location coordinates (when available)
    // Priority 2: city-substring fallback (when coordinates not available)
    if (filters.nearby) {
      const loc = (m as any).model_location as { lat_approx?: number | null; lng_approx?: number | null } | null | undefined;
      if (userLat != null && userLng != null && loc?.lat_approx != null && loc?.lng_approx != null) {
        const dist = haversineKm(userLat, userLng, loc.lat_approx, loc.lng_approx);
        if (dist > nearMeRadiusKm) return false;
      } else if (userCity) {
        // Fallback: city-substring match (no coordinates available)
        if (!(m.city || '').toLowerCase().includes(userCity.toLowerCase())) return false;
      }
    }

    // ── Hair color (case-insensitive substring) ──
    if (filters.hairColor.trim()) {
      if (!(m.hair_color || '').toLowerCase().includes(filters.hairColor.trim().toLowerCase())) return false;
    }

    // ── Measurements ──
    const hipsMin = pInt(filters.hipsMin);
    const hipsMax = pInt(filters.hipsMax);
    const waistMin = pInt(filters.waistMin);
    const waistMax = pInt(filters.waistMax);
    const chestMin = pInt(filters.chestMin);
    const chestMax = pInt(filters.chestMax);
    const legsMin = pInt(filters.legsInseamMin);
    const legsMax = pInt(filters.legsInseamMax);

    if (hipsMin !== undefined  && (m.hips  == null || m.hips  < hipsMin))  return false;
    if (hipsMax !== undefined  && (m.hips  == null || m.hips  > hipsMax))  return false;
    if (waistMin !== undefined && (m.waist == null || m.waist < waistMin)) return false;
    if (waistMax !== undefined && (m.waist == null || m.waist > waistMax)) return false;
    if (chestMin !== undefined && (m.chest == null || m.chest < chestMin)) return false;
    if (chestMax !== undefined && (m.chest == null || m.chest > chestMax)) return false;
    if (legsMin !== undefined  && (m.legs_inseam == null || m.legs_inseam < legsMin)) return false;
    if (legsMax !== undefined  && (m.legs_inseam == null || m.legs_inseam > legsMax)) return false;

    // ── Category ──
    if (filters.category) {
      if (filters.category === 'Commercial') {
        if (!m.is_visible_commercial) return false;
      } else {
        // 'Fashion' or 'High Fashion' — both require is_visible_fashion
        if (!m.is_visible_fashion) return false;
        if (filters.category === 'High Fashion') {
          const cats = m.categories ?? [];
          if (!cats.includes('High Fashion')) return false;
        }
      }
    }

    // ── Sports ──
    if (filters.sportsWinter && !m.is_sports_winter) return false;
    if (filters.sportsSummer && !m.is_sports_summer) return false;

    // ── Ethnicity (multi-select; [] = show all) ──
    if (filters.ethnicities.length > 0 && !filters.ethnicities.includes(m.ethnicity ?? '')) return false;

    return true;
  });
}

/**
 * Applies ModelFilters to a list of ModelApplication objects (Recruiting queue).
 *
 * Only the fields that exist on ModelApplication are evaluated:
 *   - sex   → app.gender
 *   - size  → app.height (bucket)
 *   - city  → app.city (substring, no countryCode required)
 *   - hairColor → app.hairColor (substring)
 *
 * Fields not present on ModelApplication (measurements, category, sports,
 * countryCode, nearby) are silently skipped so the panel stays consistent
 * with Client Discover and Agency My Models without breaking anything.
 */
export function filterApplicationsByModelFilters(
  apps: ModelApplication[],
  filters: ModelFilters,
): ModelApplication[] {
  return apps.filter((app) => {
    // ── Sex / Gender ──
    if (filters.sex === 'male'   && app.gender !== 'male')   return false;
    if (filters.sex === 'female' && app.gender !== 'female') return false;

    // ── Height (numeric range) ──
    const hMin = parseInt(filters.heightMin, 10);
    const hMax = parseInt(filters.heightMax, 10);
    const h = app.height ?? 0;
    if (!isNaN(hMin) && h < hMin) return false;
    if (!isNaN(hMax) && h > hMax) return false;

    // ── Hair color (substring, case-insensitive) ──
    if (filters.hairColor.trim()) {
      if (!(app.hairColor ?? '').toLowerCase().includes(filters.hairColor.trim().toLowerCase())) return false;
    }

    // ── City (substring, case-insensitive; no countryCode dependency) ──
    if (filters.city.trim()) {
      if (!(app.city ?? '').toLowerCase().includes(filters.city.trim().toLowerCase())) return false;
    }

    // ── Ethnicity (multi-select; [] = show all) ──
    if (filters.ethnicities.length > 0 && !filters.ethnicities.includes(app.ethnicity ?? '')) return false;

    return true;
  });
}
