/**
 * Models – alle Stammdaten, Portfolio-URLs, Polaroids in Supabase (models + model_photos).
 * Pro Partei: agency_id; Bilder-URLs und Maße persistent; parteiübergreifend sichtbar je nach RLS.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllSupabasePages } from './supabaseFetchAll';

export type SupabaseModel = {
  id: string;
  agency_id: string;
  user_id: string | null;
  /** active | pending_link | ended — ended = soft-removed from My Models, history kept */
  agency_relationship_status?: string | null;
  agency_relationship_ended_at?: string | null;
  email: string | null;
  mediaslide_sync_id: string | null;
  name: string;
  height: number;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  chest: number | null;
  legs_inseam: number | null;
  shoe_size: number | null;
  city: string | null;
  country: string | null;
  hair_color: string | null;
  eye_color: string | null;
  current_location: string | null;
  portfolio_images: string[];
  polaroids: string[];
  video_url: string | null;
  is_visible_commercial: boolean;
  is_visible_fashion: boolean;
  /** Marketing categories ('Fashion' | 'High Fashion' | 'Commercial'). NULL/empty = all categories. */
  categories: string[] | null;
  /** Sports dimension — independent of Fashion/Commercial categories. Default false. */
  is_sports_winter?: boolean;
  is_sports_summer?: boolean;
  created_at?: string;
  updated_at?: string;
  // Real physical location (nullable). `country` is a legacy field used in older code.
  country_code?: string | null;
  /** Biological sex: 'male' | 'female' | null (not yet specified). */
  sex?: 'male' | 'female' | null;
};

export async function getModelsFromSupabase(): Promise<SupabaseModel[]> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .order('name');

    if (error) {
      console.error('getModelsFromSupabase error:', error);
      return [];
    }
    return (data ?? []) as SupabaseModel[];
  } catch (e) {
    console.error('getModelsFromSupabase exception:', e);
    return [];
  }
}

/** Ein Model, das dem eingeloggten User zugeordnet ist (user_id oder E-Mail-Link). */
export async function getModelForUserFromSupabase(userId: string): Promise<SupabaseModel | null> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('getModelForUserFromSupabase error:', error);
      return null;
    }
    return (data ?? null) as SupabaseModel | null;
  } catch (e) {
    console.error('getModelForUserFromSupabase exception:', e);
    return null;
  }
}

export async function getModelByIdFromSupabase(id: string): Promise<SupabaseModel | null> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('getModelByIdFromSupabase error:', error);
      return null;
    }
    return (data as SupabaseModel) ?? null;
  } catch (e) {
    console.error('getModelByIdFromSupabase exception:', e);
    return null;
  }
}

/**
 * Build a PostgREST `.or()` filter string for category-based filtering.
 * NULL or empty categories = visible in ALL category filters.
 * A value with a space (e.g. "High Fashion") is double-quoted inside the array literal.
 */
function buildCategoryOrFilter(category: string): string {
  const escaped = category.replace(/"/g, '\\"');
  return `categories.is.null,categories.eq.{},categories.ov.{"${escaped}"}`;
}

/** Shared measurement + hair parameters for all client discovery queries. */
export type ClientMeasurementFilters = {
  heightMin?: number;
  heightMax?: number;
  hairColor?: string;
  hipsMin?: number;
  hipsMax?: number;
  waistMin?: number;
  waistMax?: number;
  chestMin?: number;
  chestMax?: number;
  legsInseamMin?: number;
  legsInseamMax?: number;
  /** Filter by biological sex: 'male' | 'female'. Omit for all. */
  sex?: 'male' | 'female';
};

/** Apply measurement/hair/sex filters to any Supabase query builder — used in all three client functions. */
function applyMeasurementFilters(q: any, f: ClientMeasurementFilters): any {
  if (f.heightMin) q = q.gte('height', f.heightMin);
  if (f.heightMax) q = q.lte('height', f.heightMax);
  if (f.hairColor?.trim()) q = q.ilike('hair_color', `%${f.hairColor.trim()}%`);
  if (f.hipsMin) q = q.gte('hips', f.hipsMin);
  if (f.hipsMax) q = q.lte('hips', f.hipsMax);
  if (f.waistMin) q = q.gte('waist', f.waistMin);
  if (f.waistMax) q = q.lte('waist', f.waistMax);
  if (f.chestMin) q = q.gte('chest', f.chestMin);
  if (f.chestMax) q = q.lte('chest', f.chestMax);
  if (f.legsInseamMin) q = q.gte('legs_inseam', f.legsInseamMin);
  if (f.legsInseamMax) q = q.lte('legs_inseam', f.legsInseamMax);
  if (f.sex) q = q.eq('sex', f.sex);
  return q;
}

export async function getModelsForClientFromSupabase(
  clientType: 'fashion' | 'commercial' | 'all',
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
  measurementFilters?: ClientMeasurementFilters,
): Promise<SupabaseModel[]> {
  return fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models')
      .select('*')
      .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
      .order('name')
      .range(from, to);
    if (clientType === 'fashion') q = q.eq('is_visible_fashion', true);
    else if (clientType === 'commercial') q = q.eq('is_visible_commercial', true);
    else q = q.or('is_visible_fashion.eq.true,is_visible_commercial.eq.true');
    if (category) q = q.or(buildCategoryOrFilter(category));
    if (sportsWinter) q = q.eq('is_sports_winter', true);
    if (sportsSummer) q = q.eq('is_sports_summer', true);
    if (measurementFilters) q = applyMeasurementFilters(q, measurementFilters);
    const { data, error } = await q;
    return { data: data as SupabaseModel[] | null, error };
  });
}

export async function getModelsForClientFromSupabaseByTerritory(
  clientType: 'fashion' | 'commercial' | 'all',
  countryCode: string,
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
  measurementFilters?: ClientMeasurementFilters,
): Promise<
  Array<
    SupabaseModel & {
      territory_country_code: string;
      agency_name: string;
      territory_agency_id?: string | null;
    }
  >
> {
  const iso = countryCode.trim().toUpperCase();
  return fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models_with_territories')
      .select('*')
      .eq('territory_country_code', iso)
      .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
      .order('name')
      .range(from, to);
    if (clientType === 'fashion') q = q.eq('is_visible_fashion', true);
    else if (clientType === 'commercial') q = q.eq('is_visible_commercial', true);
    else q = q.or('is_visible_fashion.eq.true,is_visible_commercial.eq.true');
    if (category) q = q.or(buildCategoryOrFilter(category));
    if (sportsWinter) q = q.eq('is_sports_winter', true);
    if (sportsSummer) q = q.eq('is_sports_summer', true);
    if (measurementFilters) q = applyMeasurementFilters(q, measurementFilters);
    const { data, error } = await q;
    return {
      data: data as
        | Array<
            SupabaseModel & {
              territory_country_code: string;
              agency_name: string;
              territory_agency_id?: string | null;
            }
          >
        | null,
      error,
    };
  });
}

export type HybridLocationModel = SupabaseModel & {
  has_real_location: boolean;
  territory_country_code?: string | null;
  agency_name?: string | null;
  territory_agency_id?: string | null;
};

/**
 * Hybrid-Discovery via RPC get_models_by_location (migration_get_models_by_location_rpc.sql).
 *
 * Replaces two separate fetchAllSupabasePages streams (models + models_with_territories),
 * which at 100k concurrent clients created 200k+ parallel DB round-trip sequences.
 * Now a single UNION query runs server-side per pagination page.
 */
export async function getModelsForClientFromSupabaseHybridLocation(
  clientType: 'fashion' | 'commercial' | 'all',
  countryCode: string,
  city?: string | null,
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
  measurementFilters?: ClientMeasurementFilters,
): Promise<HybridLocationModel[]> {
  const iso = countryCode.trim().toUpperCase();
  const f = measurementFilters ?? {};

  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase.rpc('get_models_by_location', {
      p_iso:              iso,
      p_client_type:      clientType,
      p_from:             from,
      p_to:               to,
      p_city:             city?.trim() ?? null,
      p_category:         category ?? null,
      p_sports_winter:    sportsWinter ?? false,
      p_sports_summer:    sportsSummer ?? false,
      p_height_min:       f.heightMin      ?? null,
      p_height_max:       f.heightMax      ?? null,
      p_hair_color:       f.hairColor      ?? null,
      p_hips_min:         f.hipsMin        ?? null,
      p_hips_max:         f.hipsMax        ?? null,
      p_waist_min:        f.waistMin       ?? null,
      p_waist_max:        f.waistMax       ?? null,
      p_chest_min:        f.chestMin       ?? null,
      p_chest_max:        f.chestMax       ?? null,
      p_legs_inseam_min:  f.legsInseamMin  ?? null,
      p_legs_inseam_max:  f.legsInseamMax  ?? null,
      p_sex:              f.sex            ?? null,
    });
    return { data: data as HybridLocationModel[] | null, error };
  });
}

export async function getModelsForAgencyFromSupabase(agencyId: string): Promise<SupabaseModel[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq('agency_id', agencyId)
      .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
      .order('name')
      .range(from, to);
    return { data: data as SupabaseModel[] | null, error };
  });
}

export async function updateModelVisibilityInSupabase(
  id: string,
  payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean }
): Promise<boolean> {
  const { error } = await supabase
    .from('models')
    .update(payload)
    .eq('id', id);

  if (error) {
    console.error('updateModelVisibilityInSupabase error:', error);
    return false;
  }
  return true;
}

/** Nach Sign-up/Sign-in: Model-Eintrag mit aktueller User-E-Mail verknüpfen (von Agentur angelegtes Model). */
export async function linkModelByEmail(): Promise<void> {
  const { error } = await supabase.rpc('link_model_by_email');
  if (error) console.error('linkModelByEmail error:', error);
}

/**
 * Agency ends representation (soft delete): model leaves My Models & client discovery;
 * past option_requests / calendar history stay in DB for reporting.
 */
export async function removeModelFromAgency(modelId: string, agencyId: string): Promise<boolean> {
  const { error } = await supabase.rpc('agency_remove_model', {
    p_model_id: modelId,
    p_agency_id: agencyId,
  });
  if (error) {
    console.error('removeModelFromAgency error:', error);
    return false;
  }
  return true;
}

/** Link a roster model to the model user who registered with this email (after API import etc.). */
export async function agencyLinkModelToUser(
  modelId: string,
  agencyId: string,
  email: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('agency_link_model_to_user', {
    p_model_id: modelId,
    p_agency_id: agencyId,
    p_email: email.trim(),
  });
  if (error) {
    console.error('agencyLinkModelToUser error:', error);
    return false;
  }
  return data === true;
}
