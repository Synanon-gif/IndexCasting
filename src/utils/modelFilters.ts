/**
 * Shared model filter types, defaults, and client-side filtering logic.
 * Used by both the Client Discover view (server-side fetch params) and the
 * Agency My Models view (client-side filtering on already-fetched models).
 */
import type { SupabaseModel } from '../services/modelsSupabase';

// ── Type ──────────────────────────────────────────────────────────────────────

export type ModelFilters = {
  /** Biological sex filter: 'all' = no restriction. */
  sex: 'all' | 'male' | 'female';
  size: 'all' | 'short' | 'medium' | 'tall';
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
  size: 'all',
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
 * @param userCity - Detected city for "Near me" filter (optional).
 */
export function filterModels(
  models: SupabaseModel[],
  filters: ModelFilters,
  userCity?: string,
): SupabaseModel[] {
  const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };

  return models.filter((m) => {
    // ── Sex ──
    if (filters.sex === 'male'   && m.sex !== 'male')   return false;
    if (filters.sex === 'female' && m.sex !== 'female') return false;

    // ── Height (size bucket) ──
    if (filters.size === 'short'  && m.height >= 175) return false;
    if (filters.size === 'medium' && (m.height < 175 || m.height > 182)) return false;
    if (filters.size === 'tall'   && m.height <= 182) return false;

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

    // ── Nearby (user's detected city) ──
    if (filters.nearby && userCity) {
      if (!(m.city || '').toLowerCase().includes(userCity.toLowerCase())) return false;
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

    return true;
  });
}
