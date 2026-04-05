/**
 * Model Locations — privacy-safe, filterable location system.
 *
 * Privacy rules:
 *   - NEVER store exact GPS. All lat/lng values are rounded to ~5 km precision
 *     before being sent to the database (roundCoord utility).
 *   - share_approximate_location = false → lat/lng stored as NULL.
 *   - source: 'model' (self-managed) | 'agency' (bulk-assigned by agency).
 *
 * Source priority:
 *   UNIQUE(model_id) means only ONE active row exists per model.
 *   Whichever source wrote last (highest updated_at) is the active location.
 *   No manual priority comparison is needed — the DB UPSERT handles it.
 *
 * City vs lat/lng:
 *   city    → display label only (may differ from GPS reverse-geocode result).
 *   lat/lng → sole criterion for radius-based Near Me filtering.
 *   Never use city as a spatial predicate; use lat/lng exclusively.
 */
import { supabase } from '../../lib/supabase';
import type { ClientMeasurementFilters } from './modelsSupabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelLocation = {
  id: string;
  model_id: string;
  city: string | null;
  country_code: string;
  lat_approx: number | null;
  lng_approx: number | null;
  share_approximate_location: boolean;
  source: 'model' | 'agency';
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
  location_source: 'model' | 'agency';
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
  source: 'model' | 'agency' = 'model',
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
 * Agency bulk upsert — sets the same location for multiple models at once.
 * Only models the caller's agency actually manages are updated; others are skipped.
 * Returns the number of rows successfully upserted.
 */
export async function bulkUpsertModelLocations(
  modelIds: string[],
  data: ModelLocationInput,
): Promise<number> {
  if (!modelIds.length) return 0;

  try {
    const roundedLat = data.lat != null ? roundCoord(data.lat) : null;
    const roundedLng = data.lng != null ? roundCoord(data.lng) : null;

    const { data: result, error } = await supabase.rpc('bulk_upsert_model_locations', {
      p_model_ids:    modelIds,
      p_country_code: data.country_code,
      p_city:         data.city ?? null,
      p_lat_approx:   roundedLat,
      p_lng_approx:   roundedLng,
    });

    if (error) {
      console.error('bulkUpsertModelLocations error:', error);
      return 0;
    }
    return (result as number) ?? 0;
  } catch (e) {
    console.error('bulkUpsertModelLocations exception:', e);
    return 0;
  }
}

/**
 * Reads the current location entry for a single model.
 * Returns null if no location has been set yet.
 */
export async function getModelLocation(modelId: string): Promise<ModelLocation | null> {
  try {
    const { data, error } = await supabase
      .from('model_locations')
      .select('*')
      .eq('model_id', modelId)
      .maybeSingle();

    if (error) {
      console.error('getModelLocation error:', error);
      return null;
    }
    return (data as ModelLocation) ?? null;
  } catch (e) {
    console.error('getModelLocation exception:', e);
    return null;
  }
}

/**
 * Deletes the location entry for a model (e.g. when a model disables location sharing entirely).
 */
export async function deleteModelLocation(modelId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('model_locations')
      .delete()
      .eq('model_id', modelId);

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
