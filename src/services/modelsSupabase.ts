/**
 * Models – alle Stammdaten, Portfolio-URLs, Polaroids in Supabase (models + model_photos).
 * Pro Partei: agency_id; Bilder-URLs und Maße persistent; parteiübergreifend sichtbar je nach RLS.
 */
import { supabase } from '../../lib/supabase';
import { serviceErr, serviceOkData, type ServiceResult } from '../types/serviceResult';
import { fetchAllSupabasePages } from './supabaseFetchAll';

/**
 * Alle Stammdaten-Felder — für Detail-Ansicht und vollständige Supabase-Roundtrips.
 * Entspricht 1:1 dem SupabaseModel-Interface.
 */
const MODEL_DETAIL_SELECT =
  'id, agency_id, user_id, agency_relationship_status, agency_relationship_ended_at, email, mediaslide_sync_id, netwalk_model_id, name, height, bust, waist, hips, chest, legs_inseam, shoe_size, city, country, hair_color, eye_color, current_location, portfolio_images, polaroids, video_url, is_visible_commercial, is_visible_fashion, categories, is_sports_winter, is_sports_summer, created_at, updated_at, country_code, sex, ethnicity' as const;

/**
 * Reduzierte Felder für Listen-Ansichten (Swipe, Roster).
 * Bewusst ohne portfolio_images/polaroids-Arrays — diese werden per
 * modelPhotosSupabase.ts lazy geladen.
 */
const MODEL_LIST_SELECT =
  'id, agency_id, user_id, agency_relationship_status, name, height, bust, waist, hips, chest, legs_inseam, shoe_size, city, country, hair_color, eye_color, current_location, is_visible_commercial, is_visible_fashion, categories, is_sports_winter, is_sports_summer, country_code, sex, ethnicity, mediaslide_sync_id' as const;

export type SupabaseModel = {
  id: string;
  agency_id: string;
  user_id: string | null;
  /** active | pending_link | ended — ended = soft-removed from My Models, history kept */
  agency_relationship_status?: string | null;
  agency_relationship_ended_at?: string | null;
  email: string | null;
  mediaslide_sync_id: string | null;
  /** Netwalk model ID for bidirectional sync (see netwalkSyncService). */
  netwalk_model_id?: string | null;
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
  /** Ethnic background — free text matching ETHNICITY_OPTIONS. Null = not specified. */
  ethnicity?: string | null;
};

export async function getModelsFromSupabase(): Promise<SupabaseModel[]> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
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

export type SwipeFilters = {
  height?: 'all' | 'short' | 'medium' | 'tall';
  city?: 'all' | string;
  hairColor?: 'all' | string;
};

/**
 * Paginated model fetch for the Swipe/Discovery screen.
 * Filters are applied server-side so only the requested slice is transferred.
 * Uses .range() for offset pagination — acceptable for Discovery where inserts
 * during a session are rare and page drift is tolerable.
 *
 * HIGH-03: Platform access is enforced server-side before fetching models.
 * Without this check, a user with an expired subscription/trial could
 * still discover models by calling this function directly (e.g. via
 * Postman or a modified app). The RLS on `models` is the authoritative
 * protection; this call is belt-and-suspenders defense-in-depth.
 */
export async function getModelsPagedFromSupabase(
  offset: number,
  limit: number,
  filters?: SwipeFilters,
): Promise<SupabaseModel[]> {
  // HIGH-03: Enforce platform access before any model data is returned.
  // Throws with code 'platform_access_denied' if subscription/trial is invalid.
  await assertPlatformAccess();

  try {
    let query = supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
      .order('name')
      .range(offset, offset + limit - 1);

    if (filters?.city && filters.city !== 'all') {
      query = query.eq('city', filters.city);
    }
    if (filters?.hairColor && filters.hairColor !== 'all') {
      query = query.eq('hair_color', filters.hairColor);
    }
    if (filters?.height && filters.height !== 'all') {
      if (filters.height === 'short')  query = query.lt('height', 175);
      if (filters.height === 'medium') query = query.gte('height', 175).lte('height', 182);
      if (filters.height === 'tall')   query = query.gt('height', 182);
    }

    const { data, error } = await query;
    if (error) {
      console.error('getModelsPagedFromSupabase error:', error);
      return [];
    }
    return (data ?? []) as SupabaseModel[];
  } catch (e) {
    console.error('getModelsPagedFromSupabase exception:', e);
    return [];
  }
}

/** Ein Model, das dem eingeloggten User zugeordnet ist (user_id oder E-Mail-Link). */
export async function getModelForUserFromSupabase(userId: string): Promise<SupabaseModel | null> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
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

/**
 * Fetch a single model by ID — for agency-internal operations (create, edit,
 * sync, roster management) and B2B contexts (messenger, option requests).
 *
 * Security: This function relies on RLS for data isolation — agency members
 * see only their own models, clients only see models with active territories
 * (enforced by migration_models_rls_clients_via_territories.sql).
 * Do NOT use this for client-facing model discovery — use
 * getModelByIdForClientFromSupabase() which additionally enforces the
 * subscription/paywall gate. (HIGH-03)
 */
export async function getModelByIdFromSupabase(id: string): Promise<SupabaseModel | null> {
  try {
    const { data, error } = await supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
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
 * HIGH-03: Client-facing model detail fetch with paywall enforcement.
 *
 * Use this variant whenever a CLIENT user is loading a model by ID
 * (e.g. detail view from search results, shared link context with auth).
 * assertPlatformAccess() is called first so that expired-trial / no-sub
 * clients cannot enumerate model data even if they bypass the UI.
 */
export async function getModelByIdForClientFromSupabase(id: string): Promise<SupabaseModel | null> {
  await assertPlatformAccess();
  return getModelByIdFromSupabase(id);
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
  /** Multi-select ethnicity filter. Empty or omitted = no restriction. */
  ethnicities?: string[];
};

/** Apply measurement/hair/sex filters to any Supabase query builder — used in all three client functions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (f.ethnicities?.length) q = q.in('ethnicity', f.ethnicities);
  return q;
}

/**
 * Enforces the platform access gate server-side.
 * Throws with code 'platform_access_denied' when the caller's org has no
 * active subscription / trial / admin override. Used before direct-table
 * model discovery queries where the RLS on `models` is USING(true).
 */
async function assertPlatformAccess(): Promise<void> {
  const { data, error } = await supabase.rpc('can_access_platform');
  if (error) {
    console.error('assertPlatformAccess RPC error:', error);
    throw new Error('platform_access_check_failed');
  }
  const result = data as { allowed: boolean; reason?: string } | null;
  if (!result?.allowed) {
    throw Object.assign(new Error('platform_access_denied'), {
      code: 'platform_access_denied',
      reason: result?.reason ?? 'unknown',
    });
  }
}

export async function getModelsForClientFromSupabase(
  clientType: 'fashion' | 'commercial' | 'all',
  category?: string,
  sportsWinter?: boolean,
  sportsSummer?: boolean,
  measurementFilters?: ClientMeasurementFilters,
): Promise<SupabaseModel[]> {
  await assertPlatformAccess();
  return fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models')
      .select(MODEL_LIST_SELECT)
      .eq('is_active', true)
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
  await assertPlatformAccess();
  const iso = countryCode.trim().toUpperCase();
  return fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models_with_territories')
      .select(MODEL_LIST_SELECT + ', territory_country_code, agency_name, territory_agency_id')
      .eq('territory_country_code', iso)
      .eq('is_active', true)
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
  // Defense-in-depth paywall guard (H-4 fix, Security Audit 2026-04).
  // The get_models_by_location RPC already enforces has_platform_access() server-side,
  // but this client-side check provides an early exit and consistent UX with the
  // other discovery functions (getModelsForClientFromSupabase / ByTerritory).
  await assertPlatformAccess();

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
      p_ethnicities:      f.ethnicities?.length ? f.ethnicities : null,
    });
    return { data: data as HybridLocationModel[] | null, error };
  });
}

export async function getModelsForAgencyFromSupabase(agencyId: string): Promise<SupabaseModel[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
      .eq('agency_id', agencyId)
      .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
      .order('name')
      .range(from, to);
    return { data: data as SupabaseModel[] | null, error };
  });
}

/**
 * Org-zentrische Variante: Models via model_assignments statt models.agency_id.
 * Gibt alle Models zurück, für die die Organization mindestens einen model_assignments-Eintrag hat.
 * Verwendet RLS — der Caller muss Mitglied der Organisation sein.
 */
export async function getModelsForOrganizationFromSupabase(organizationId: string): Promise<SupabaseModel[]> {
  try {
    const { data, error } = await supabase
      .from('model_assignments')
      .select(`model_id`)
      .eq('organization_id', organizationId);

    if (error) {
      console.error('getModelsForOrganizationFromSupabase assignments error:', error);
      return [];
    }

    const modelIds = [...new Set((data ?? []).map((row: { model_id: string }) => row.model_id))];
    if (modelIds.length === 0) return [];

    return fetchAllSupabasePages(async (from, to) => {
      const { data: models, error: mErr } = await supabase
        .from('models')
        .select(MODEL_DETAIL_SELECT)
        .in('id', modelIds)
        .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
        .order('name')
        .range(from, to);
      return { data: models as SupabaseModel[] | null, error: mErr };
    });
  } catch (e) {
    console.error('getModelsForOrganizationFromSupabase exception:', e);
    return [];
  }
}

export async function updateModelVisibilityInSupabase(
  id: string,
  payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean }
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('agency_update_model_full', {
      p_model_id: id,
      p_is_visible_commercial: payload.is_visible_commercial ?? null,
      p_is_visible_fashion: payload.is_visible_fashion ?? null,
    });

    if (error) {
      console.error('updateModelVisibilityInSupabase error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateModelVisibilityInSupabase exception:', e);
    return false;
  }
}

/**
 * @deprecated Use claimModelByToken() instead.
 * Kept for backward compatibility: links already-unlinked model records via email.
 * Will be removed once all agencies use the token flow (Fix C, 20260413).
 */
export async function linkModelByEmail(): Promise<void> {
  try {
    const { error } = await supabase.rpc('link_model_by_email');
    if (error) console.error('linkModelByEmail error:', error);
  } catch (e) {
    console.error('linkModelByEmail exception:', e);
  }
}

/**
 * Model uses a one-time claim token (generated by the agency via
 * generateModelClaimToken) to link their account to a model record.
 * Replaces email-based link_model_by_email() (Gefahr 2 fix, Fix C 20260413).
 */
export async function claimModelByToken(
  token: string,
): Promise<ServiceResult<{ modelId: string; agencyId: string }>> {
  try {
    const { data, error } = await supabase.rpc('claim_model_by_token', { p_token: token });
    if (error) {
      console.error('claimModelByToken error:', error);
      return serviceErr(error.message ?? 'claim_failed');
    }
    const result = data as { model_id: string; agency_id: string } | null;
    if (!result?.model_id) return serviceErr('no_result');
    return serviceOkData({ modelId: result.model_id, agencyId: result.agency_id });
  } catch (e) {
    console.error('claimModelByToken exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

/**
 * Agency generates a one-time claim token for a model record.
 * The agency sends this token to the model (e.g. via email, out-of-band).
 * The model calls claimModelByToken() with this token to link their account.
 *
 * @param organizationId When the model has no `agency_id` yet, pass the active
 *   `organizations.id` so multi-org bookers do not rely on implicit oldest membership.
 */
export async function generateModelClaimToken(
  modelId: string,
  organizationId?: string | null,
): Promise<{ token: string } | { error: string }> {
  try {
    const trimmedOrg = organizationId?.trim();
    const { data, error } = await supabase.rpc('generate_model_claim_token', {
      p_model_id: modelId,
      ...(trimmedOrg ? { p_organization_id: trimmedOrg } : {}),
    });
    if (error) {
      console.error('generateModelClaimToken error:', error);
      return { error: error.message };
    }
    if (!data) return { error: 'no_token_returned' };
    return { token: data as string };
  } catch (e) {
    console.error('generateModelClaimToken exception:', e);
    return { error: String(e) };
  }
}

/**
 * Builds the model claim URL for a given token.
 * Used by the agency to share the link with the model (via email or manually).
 * Parallel to buildOrganizationInviteUrl in organizationsInvitationsSupabase.ts.
 */
export function buildModelClaimUrl(token: string): string {
  const APP_BASE_URL = 'https://index-casting.com';
  if (typeof window !== 'undefined' && window.location?.origin) {
    const u = new URL(window.location.origin + (window.location.pathname || '/'));
    u.searchParams.set('model_invite', token);
    return u.toString();
  }
  return `${APP_BASE_URL}/?model_invite=${encodeURIComponent(token)}`;
}

export interface ModelClaimPreview {
  valid: boolean;
  model_name?: string;
  agency_name?: string;
  error?: string;
}

/**
 * Fetches agency_name + model_name for a model claim token without requiring authentication.
 * Used in App.tsx to show a preview screen before the model creates their account.
 */
export async function getModelClaimPreview(token: string): Promise<ModelClaimPreview | null> {
  try {
    const { data, error } = await supabase.rpc('get_model_claim_preview', { p_token: token });
    if (error) {
      console.error('getModelClaimPreview error:', error);
      return null;
    }
    return data as ModelClaimPreview;
  } catch (e) {
    console.error('getModelClaimPreview exception:', e);
    return null;
  }
}

/**
 * Fix H: Returns all agencies + territories for the calling model user.
 * Models use model_agency_territories (not organization_members) as their org anchor.
 * Returns an empty array during the application phase (before any agency link is confirmed).
 */
export type ModelAgencyContext = {
  modelId: string;
  agencyId: string;
  agencyName: string;
  organizationId: string | null;
  territory: string;
};

export async function getMyModelAgencies(): Promise<ModelAgencyContext[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_model_agencies');
    if (error) {
      console.error('getMyModelAgencies error:', error);
      return [];
    }
    if (!data || !Array.isArray(data)) return [];
    return data.map((row: Record<string, unknown>) => ({
      modelId:        row.model_id        as string,
      agencyId:       row.agency_id       as string,
      agencyName:     row.agency_name     as string,
      organizationId: (row.organization_id as string) ?? null,
      territory:      row.territory       as string,
    }));
  } catch (e) {
    console.error('getMyModelAgencies exception:', e);
    return [];
  }
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
