/**
 * Model Locations — privacy-safe, filterable location system.
 *
 * Privacy rules:
 *   - NEVER store exact GPS. All lat/lng values are rounded to ~5 km precision
 *     before being sent to the database (roundCoord utility).
 *   - share_approximate_location = false → lat/lng stored as NULL.
 *
 * Source system (3 values, priority-enforced at DB write time):
 *   'live'    — model's browser GPS capture (highest precision; model controls)
 *   'current' — model-typed city with Nominatim geocoding (model controls)
 *   'agency'  — agency-set fallback for models without accounts (lowest priority)
 *
 * Priority: live > current > agency
 *   Write: each source has its own isolated row (UNIQUE model_id, source).
 *   Agency writes go to (model_id, 'agency') and never touch live/current rows.
 *   Read: getModelLocation returns highest-priority source; DB uses DISTINCT ON.
 *   See upsert_model_location RPC (20260406_location_multirow_priority.sql).
 *
 * City vs lat/lng:
 *   city    → display label only (may differ from GPS reverse-geocode result).
 *   lat/lng → sole criterion for radius-based Near Me filtering.
 *   Never use city as a spatial predicate; use lat/lng exclusively.
 */
import { supabase } from '../../lib/supabase';
import type { ClientMeasurementFilters } from './modelsSupabase';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The 3 location data sources, in priority order (highest first).
 * Enforced at DB write time — agency writes are no-ops when model owns the row.
 */
export type LocationSource = 'live' | 'current' | 'agency';

/** Returns a human-readable label for a location source. */
export function locationSourceLabel(source: LocationSource): string {
  if (source === 'live') return 'Live GPS';
  if (source === 'current') return 'Current location';
  return 'Set by agency';
}

/** Numeric priority: live=2 (highest), current=1, agency=0 (lowest). */
export function locationSourcePriority(source: LocationSource): number {
  return source === 'live' ? 2 : source === 'current' ? 1 : 0;
}

export type ModelLocation = {
  id: string;
  model_id: string;
  city: string | null;
  country_code: string;
  lat_approx: number | null;
  lng_approx: number | null;
  share_approximate_location: boolean;
  source: LocationSource;
  updated_at: string;
};

export type ModelLocationInput = {
  country_code: string;
  city?: string | null;
  /** Client-supplied lat. Will be rounded to ~5 km before saving. */
  lat?: number | null;
  /** Client-supplied lng. Will be rounded to ~5 km before saving. */
  lng?: number | null;
  share_approximate_location?: boolean;
};

export type NearbyModel = {
  id: string;
  name: string;
  city: string | null;
  country_code: string | null;
  hair_color: string | null;
  height: number;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  chest: number | null;
  legs_inseam: number | null;
  is_visible_fashion: boolean;
  is_visible_commercial: boolean;
  categories: string[] | null;
  is_sports_winter?: boolean;
  is_sports_summer?: boolean;
  sex?: 'male' | 'female' | null;
  ethnicity?: string | null;
  portfolio_images: string[];
  polaroids: string[];
  agency_id: string;
  location_city: string | null;
  location_country_code: string;
  lat_approx: number | null;
  lng_approx: number | null;
  location_source: LocationSource;
  location_updated_at: string;
  distance_km: number;
  territory_country_code?: string | null;
  agency_name?: string | null;
  territory_agency_id?: string | null;
};

// ── Privacy utils ─────────────────────────────────────────────────────────────

/**
 * Rounds a coordinate to ~5 km precision (2 decimal places ≈ 1.1 km,
 * but we use multiples of 0.05 ≈ 5.5 km for better anonymisation).
 */
export function roundCoord(coord: number): number {
  return Math.round(coord * 20) / 20;
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Upserts (inserts or updates) the location for a single model.
 * The caller must own the model (model user) or be an agency member.
 * lat/lng are rounded before being passed to the RPC.
 */
export async function upsertModelLocation(
  modelId: string,
  data: ModelLocationInput,
  source: LocationSource = 'current',
): Promise<boolean> {
  try {
    const roundedLat = data.lat != null ? roundCoord(data.lat) : null;
    const roundedLng = data.lng != null ? roundCoord(data.lng) : null;
    // Default false: only the model's own GPS consent (ModelProfileScreen) should
    // enable approximate location sharing. Agency-writes always pass false explicitly.
    const shareLocation = data.share_approximate_location ?? false;

    const { error } = await supabase.rpc('upsert_model_location', {
      p_model_id:                   modelId,
      p_country_code:               data.country_code,
      p_city:                       data.city ?? null,
      p_lat_approx:                 shareLocation ? roundedLat : null,
      p_lng_approx:                 shareLocation ? roundedLng : null,
      p_share_approximate_location: shareLocation,
      p_source:                     source,
    });

    if (error) {
      console.error('upsertModelLocation error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('upsertModelLocation exception:', e);
    return false;
  }
}

/**
 * Returns all location rows for a model, sorted by source priority descending
 * (live first, then current, then agency).
 * With UNIQUE(model_id, source) there can be up to 3 rows.
 */
export async function getAllModelLocations(modelId: string): Promise<ModelLocation[]> {
  try {
    const { data, error } = await supabase
      .from('model_locations')
      .select('*')
      .eq('model_id', modelId);

    if (error) {
      console.error('getAllModelLocations error:', error);
      return [];
    }
    const rows = (data ?? []) as ModelLocation[];
    // Sort by priority descending: live=2, current=1, agency=0
    return rows.sort((a, b) => locationSourcePriority(b.source) - locationSourcePriority(a.source));
  } catch (e) {
    console.error('getAllModelLocations exception:', e);
    return [];
  }
}

/**
 * Returns the highest-priority active location for a model.
 * Priority: live > current > agency (same as DB DISTINCT ON ordering).
 * Returns null if no location exists for any source.
 */
export async function getModelLocation(modelId: string): Promise<ModelLocation | null> {
  const all = await getAllModelLocations(modelId);
  return all[0] ?? null;
}

/**
 * Picks the highest-priority non-empty city per model_id from raw rows
 * (live > current > agency). Exported for unit tests.
 */
export function mergeEffectiveDisplayCitiesFromRows(
  rows: ReadonlyArray<{ model_id: string; city: string | null; source: string }>,
): Map<string, string> {
  const best = new Map<string, { city: string; pri: number }>();
  for (const row of rows) {
    const c = row.city?.trim();
    if (!c) continue;
    const src: LocationSource =
      row.source === 'live' || row.source === 'current' || row.source === 'agency'
        ? row.source
        : 'agency';
    const pri = locationSourcePriority(src);
    const cur = best.get(row.model_id);
    if (!cur || pri > cur.pri) best.set(row.model_id, { city: c, pri });
  }
  const out = new Map<string, string>();
  for (const [id, v] of best) out.set(id, v.city);
  return out;
}

/** Max UUIDs per .in() chunk to stay within URL/query limits. */
const EFFECTIVE_CITY_BATCH = 100;

/**
 * Batch-resolves display city for many models in few round-trips (RLS applies).
 * Same priority as discovery RPCs (live > current > agency).
 */
export async function fetchEffectiveDisplayCitiesForModels(
  modelIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(modelIds.filter((id) => id?.trim()))];
  if (unique.length === 0) return new Map();
  try {
    const allRows: Array<{ model_id: string; city: string | null; source: string }> = [];
    for (let i = 0; i < unique.length; i += EFFECTIVE_CITY_BATCH) {
      const chunk = unique.slice(i, i + EFFECTIVE_CITY_BATCH);
      const { data, error } = await supabase
        .from('model_locations')
        .select('model_id, city, source')
        .in('model_id', chunk);
      if (error) {
        console.error('fetchEffectiveDisplayCitiesForModels error:', error);
        continue;
      }
      allRows.push(
        ...((data ?? []) as Array<{ model_id: string; city: string | null; source: string }>),
      );
    }
    return mergeEffectiveDisplayCitiesFromRows(allRows);
  } catch (e) {
    console.error('fetchEffectiveDisplayCitiesForModels exception:', e);
    return new Map();
  }
}

/**
 * Source-aware location deletion.
 * Uses the SECURITY DEFINER RPC to enforce authorization:
 *   - source='live'/'current' → only the model's own user can delete
 *   - source='agency' → only agency members can delete
 *   - source=undefined → deletes all model-owned sources (live + current); agency row preserved
 *
 * Removing 'live' naturally falls back to 'current' or 'agency' via priority resolution.
 */
export async function deleteModelLocation(
  modelId: string,
  source?: LocationSource,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('delete_model_location_source', {
      p_model_id: modelId,
      p_source: source ?? null,
    });

    if (error) {
      console.error('deleteModelLocation error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteModelLocation exception:', e);
    return false;
  }
}

/**
 * Maximum number of nearby models returned in a single call.
 * Replaces the old fetchAllSupabasePages (all-pages) approach, which could
 * produce thousands of round-trips on large datasets. 200 results are more
 * than sufficient for a UX-sensible radius-discovery list sorted by distance.
 */
const NEAR_LOCATION_LIMIT = 200;

/**
 * Radius-based model discovery.
 * Returns up to NEAR_LOCATION_LIMIT visible models within p_radiusKm of the
 * given (rounded) coordinates, sorted by distance ASC.
 *
 * Models WITHOUT a location or with share_approximate_location = false are excluded.
 * The caller MUST round their own coordinates before passing (use roundCoord).
 */
export async function getModelsNearLocation(
  clientLat: number,
  clientLng: number,
  radiusKm: number = 50,
  clientType: 'fashion' | 'commercial' | 'all' = 'all',
  measurementFilters?: ClientMeasurementFilters,
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
): Promise<NearbyModel[]> {
  const f = measurementFilters ?? {};

  try {
    const { data, error } = await supabase.rpc('get_models_near_location', {
      p_lat:             roundCoord(clientLat),
      p_lng:             roundCoord(clientLng),
      p_radius_km:       radiusKm,
      p_client_type:     clientType,
      p_from:            0,
      p_to:              NEAR_LOCATION_LIMIT - 1,
      p_category:        category ?? null,
      p_sports_winter:   sportsWinter ?? false,
      p_sports_summer:   sportsSummer ?? false,
      p_height_min:      f.heightMin      ?? null,
      p_height_max:      f.heightMax      ?? null,
      p_hair_color:      f.hairColor      ?? null,
      p_hips_min:        f.hipsMin        ?? null,
      p_hips_max:        f.hipsMax        ?? null,
      p_waist_min:       f.waistMin       ?? null,
      p_waist_max:       f.waistMax       ?? null,
      p_chest_min:       f.chestMin       ?? null,
      p_chest_max:       f.chestMax       ?? null,
      p_legs_inseam_min: f.legsInseamMin  ?? null,
      p_legs_inseam_max: f.legsInseamMax  ?? null,
      p_sex:             f.sex            ?? null,
      p_ethnicities:     f.ethnicities?.length ? f.ethnicities : null,
    });
    if (error) {
      console.error('getModelsNearLocation RPC error:', error);
      return [];
    }
    return (data ?? []) as NearbyModel[];
  } catch (e) {
    console.error('getModelsNearLocation exception:', e);
    return [];
  }
}
