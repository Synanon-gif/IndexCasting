/**
 * Models – alle Stammdaten, Portfolio-URLs, Polaroids in Supabase (models + model_photos).
 * Pro Partei: agency_id; Bilder-URLs und Maße persistent; parteiübergreifend sichtbar je nach RLS.
 *
 * ─── Canonical vs technical `.from('models')` (shadow-path guardrail) ─────────
 * **Agency roster (canonical):** `getModelsForAgencyFromSupabase` loads model ids from
 * `model_agency_territories` for the agency, then fetches those models only; eligibility is
 * MAT membership (`modelEligibleForAgencyRoster`). Use for My Models; do not duplicate roster logic.
 *
 * **Other exports in this file** (single-row, client discovery hybrids, org assignments): intentional
 * technical paths — not roster substitutes. Examples: `getModelByIdFromSupabase`,
 * `getModelsPagedFromSupabase`, `getModelsForClientFromSupabase*`, `getModelsForOrganizationFromSupabase`.
 *
 * **Not in this file** (also legitimate `models` queries): adminSupabase, gdprComplianceSupabase,
 * optionRequestsSupabase (resolvers), modelPhotosSupabase, modelsImportSupabase, connectors, store fallbacks.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { logAction } from '../utils/logAction';
import { logger } from '../utils/logger';
import { filterModelsByChestCoalesce } from '../utils/filterModelsByChestCoalesce';
import { serviceErr, serviceOkData, type ServiceResult } from '../types/serviceResult';
import { fetchAllSupabasePages } from './supabaseFetchAll';
import { modelEligibleForAgencyRoster } from '../utils/modelRosterEligibility';
import {
  devAssertAgencyRosterMatchesEligibility,
  logInvariantDev,
} from '../utils/invariantValidationDev';

function isAgencyUpdateModelDevGuardOn(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    return typeof g.__DEV__ !== 'undefined'
      ? Boolean(g.__DEV__)
      : process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * DEV: Detect mistaken use of the profile-update RPC for roster removal or empty no-op media wipes.
 * Production: no-op (zero overhead intent).
 */
export function devWarnIfAgencyUpdateModelFullMisuse(payload: Record<string, unknown>): void {
  if (!isAgencyUpdateModelDevGuardOn()) return;
  if (payload.p_agency_relationship_status === 'ended') {
    console.warn(
      '[INVALID USAGE] agency_update_model_full used for removal — use removeModelFromAgency (agency_remove_model)',
    );
    return;
  }
  const skip = new Set(['p_model_id', 'p_polaroids', 'p_portfolio_images']);
  let anyOther = false;
  for (const [k, v] of Object.entries(payload)) {
    if (skip.has(k)) continue;
    if (v !== null && v !== undefined) {
      anyOther = true;
      break;
    }
  }
  const polarEmpty =
    Array.isArray(payload.p_polaroids) && (payload.p_polaroids as unknown[]).length === 0;
  const portEmpty =
    Array.isArray(payload.p_portfolio_images) &&
    (payload.p_portfolio_images as unknown[]).length === 0;
  if (polarEmpty && portEmpty && !anyOther) {
    console.warn(
      '[INVALID USAGE] agency_update_model_full used for removal (only empty polaroids + portfolio) — use agency_remove_model if ending representation',
    );
  }
}

/** Single choke point for `agency_update_model_full` (DEV misuse warnings + RPC). */
export async function agencyUpdateModelFullRpc(
  payload: Record<string, unknown>,
): Promise<{ error: PostgrestError | null }> {
  devWarnIfAgencyUpdateModelFullMisuse(payload);
  const { error } = await supabase.rpc('agency_update_model_full', payload as never);
  return { error };
}

/**
 * Alle Stammdaten-Felder — für Detail-Ansicht und vollständige Supabase-Roundtrips.
 * Entspricht 1:1 dem SupabaseModel-Interface.
 */
const MODEL_DETAIL_SELECT =
  'id, agency_id, user_id, agency_relationship_status, agency_relationship_ended_at, email, mediaslide_sync_id, netwalk_model_id, name, height, bust, waist, hips, chest, legs_inseam, shoe_size, city, country, hair_color, eye_color, current_location, portfolio_images, polaroids, video_url, is_visible_commercial, is_visible_fashion, categories, is_sports_winter, is_sports_summer, created_at, updated_at, country_code, sex, ethnicity, mother_agency_name, mother_agency_contact' as const;

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
  /** Canonical city from model_locations (live>current>agency). Present when loaded via RPCs that join model_locations. */
  effective_city?: string | null;
  /**
   * Mother-agency free-text name. NULL = no mother agency / this agency is primary.
   * Edited only via `agency_update_model_full` (Agency Owner / Booker).
   * Visible per existing models RLS to: Agency members, the model, and territory-paired clients.
   * NEVER auto-filled by package importers (see package-import-invariants §I).
   */
  mother_agency_name?: string | null;
  /**
   * Mother-agency contact (email, phone, booker name) — agency-internal in the UI.
   * Same RLS scope on the column itself; UI restricts display to agency members.
   * NEVER auto-filled by package importers.
   */
  mother_agency_contact?: string | null;
};

export async function getModelsFromSupabase(opts?: { limit?: number }): Promise<SupabaseModel[]> {
  try {
    const limit = opts?.limit ?? 200;
    const { data, error } = await supabase
      .from('models')
      .select(MODEL_DETAIL_SELECT)
      .order('name')
      .limit(limit);

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
      query = query.ilike('city', `%${filters.city}%`);
    }
    if (filters?.hairColor && filters.hairColor !== 'all') {
      query = query.eq('hair_color', filters.hairColor);
    }
    if (filters?.height && filters.height !== 'all') {
      if (filters.height === 'short') query = query.lt('height', 175);
      if (filters.height === 'medium') query = query.gte('height', 175).lte('height', 182);
      if (filters.height === 'tall') query = query.gt('height', 182);
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

const CLIENT_MODEL_IDS_CHUNK = 80;

/**
 * Batch load models for client contexts (e.g. project hydration) with a single
 * paywall check and chunked `.in('id', …)` queries — same RLS as per-id fetches.
 */
export async function getModelsByIdsForClientFromSupabase(
  ids: string[],
): Promise<Map<string, SupabaseModel>> {
  const out = new Map<string, SupabaseModel>();
  const unique = [...new Set(ids.filter((id) => id?.trim()))];
  if (unique.length === 0) return out;

  await assertPlatformAccess();

  for (let i = 0; i < unique.length; i += CLIENT_MODEL_IDS_CHUNK) {
    const chunk = unique.slice(i, i + CLIENT_MODEL_IDS_CHUNK);
    try {
      const { data, error } = await supabase
        .from('models')
        .select(MODEL_DETAIL_SELECT)
        .in('id', chunk);
      if (error) {
        console.error('getModelsByIdsForClientFromSupabase chunk error:', error);
        continue;
      }
      for (const row of data ?? []) {
        const m = row as SupabaseModel;
        out.set(m.id, m);
      }
    } catch (e) {
      console.error('getModelsByIdsForClientFromSupabase chunk exception:', e);
    }
  }

  return out;
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

export { filterModelsByChestCoalesce };

/** Apply measurement/hair/sex filters to a PostgREST query (chest via {@link filterModelsByChestCoalesce}). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMeasurementFilters(q: any, f: ClientMeasurementFilters): any {
  if (f.heightMin) q = q.gte('height', f.heightMin);
  if (f.heightMax) q = q.lte('height', f.heightMax);
  if (f.hairColor?.trim()) q = q.ilike('hair_color', `%${f.hairColor.trim()}%`);
  if (f.hipsMin) q = q.gte('hips', f.hipsMin);
  if (f.hipsMax) q = q.lte('hips', f.hipsMax);
  if (f.waistMin) q = q.gte('waist', f.waistMin);
  if (f.waistMax) q = q.lte('waist', f.waistMax);
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
    logger.error('models', 'assertPlatformAccess RPC failed — platform access denied', {
      message: error.message,
      code: (error as { code?: string }).code,
    });
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
  const rows = await fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models')
      .select(MODEL_LIST_SELECT)
      .eq('is_active', true)
      .or(
        'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link',
      )
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
  return measurementFilters ? filterModelsByChestCoalesce(rows, measurementFilters) : rows;
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
  const rows = await fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('models_with_territories')
      .select(MODEL_LIST_SELECT + ', territory_country_code, agency_name, territory_agency_id')
      .eq('territory_country_code', iso)
      .eq('is_active', true)
      .or(
        'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link',
      )
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
      data: data as Array<
        SupabaseModel & {
          territory_country_code: string;
          agency_name: string;
          territory_agency_id?: string | null;
        }
      > | null,
      error,
    };
  });
  return measurementFilters ? filterModelsByChestCoalesce(rows, measurementFilters) : rows;
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
  citySearchLat?: number | null,
  citySearchLng?: number | null,
  citySearchRadiusKm?: number | null,
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
      p_iso: iso,
      p_client_type: clientType,
      p_from: from,
      p_to: to,
      p_city: city?.trim() ?? null,
      p_category: category ?? null,
      p_sports_winter: sportsWinter ?? false,
      p_sports_summer: sportsSummer ?? false,
      p_height_min: f.heightMin ?? null,
      p_height_max: f.heightMax ?? null,
      p_hair_color: f.hairColor ?? null,
      p_hips_min: f.hipsMin ?? null,
      p_hips_max: f.hipsMax ?? null,
      p_waist_min: f.waistMin ?? null,
      p_waist_max: f.waistMax ?? null,
      p_chest_min: f.chestMin ?? null,
      p_chest_max: f.chestMax ?? null,
      p_legs_inseam_min: f.legsInseamMin ?? null,
      p_legs_inseam_max: f.legsInseamMax ?? null,
      p_sex: f.sex ?? null,
      p_ethnicities: f.ethnicities?.length ? f.ethnicities : null,
      p_search_lat: citySearchLat ?? null,
      p_search_lng: citySearchLng ?? null,
      p_city_radius_km:
        citySearchLat != null && citySearchLng != null ? (citySearchRadiusKm ?? null) : null,
    });
    return { data: data as HybridLocationModel[] | null, error };
  });
}

export { modelEligibleForAgencyRoster } from '../utils/modelRosterEligibility';

/** PostgREST `.in()` — keep chunks conservative for URL/query limits. */
const AGENCY_ROSTER_ID_IN_CHUNK = 100;

const AGENCY_ROSTER_RELATIONSHIP_OR =
  'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link';

async function fetchAgencyRosterModelsByMatIds(modelIds: string[]): Promise<SupabaseModel[]> {
  const unique = [...new Set(modelIds.map((id) => id?.trim()).filter(Boolean))] as string[];
  if (unique.length === 0) return [];

  const parts: SupabaseModel[] = [];
  for (let i = 0; i < unique.length; i += AGENCY_ROSTER_ID_IN_CHUNK) {
    const chunk = unique.slice(i, i + AGENCY_ROSTER_ID_IN_CHUNK);
    const rows = await fetchAllSupabasePages(async (from, to) => {
      const { data, error } = await supabase
        .from('models')
        .select(MODEL_DETAIL_SELECT)
        .in('id', chunk)
        .or(AGENCY_ROSTER_RELATIONSHIP_OR)
        .order('name')
        .range(from, to);
      return { data: data as SupabaseModel[] | null, error };
    });
    parts.push(...rows);
  }

  parts.sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
  );
  return parts;
}

export async function getModelsForAgencyFromSupabase(agencyId: string): Promise<SupabaseModel[]> {
  const aid = agencyId?.trim();
  if (!aid) return [];

  let matModelIds = new Set<string>();
  let matLookupOk = false;
  try {
    const matRows = await fetchAllSupabasePages<{ model_id: string }>(async (from, to) => {
      const { data, error } = await supabase
        .from('model_agency_territories')
        .select('model_id')
        .eq('agency_id', aid)
        .order('model_id')
        .range(from, to);
      return { data, error };
    });
    matModelIds = new Set(matRows.map((r) => r.model_id));
    matLookupOk = true;
  } catch (e) {
    console.error(
      'getModelsForAgencyFromSupabase: model_agency_territories fetch failed — empty roster (fail-closed)',
      e,
    );
    return [];
  }

  if (matModelIds.size === 0) {
    return [];
  }

  const models = await fetchAgencyRosterModelsByMatIds([...matModelIds]);
  const roster = models.filter((m) => modelEligibleForAgencyRoster(m, matModelIds));

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    for (const m of roster) {
      if (!matModelIds.has(m.id)) {
        logInvariantDev('warn', 'roster', 'integrity', 'roster row not in MAT set (unexpected)', {
          readPath: 'mat_ids_chunked',
          agencyId: aid,
          modelId: m.id,
        });
      }
    }
    const matNotLoaded = [...matModelIds].filter((id) => !roster.some((r) => r.id === id));
    if (matNotLoaded.length > 0) {
      logInvariantDev('warn', 'roster', 'integrity', 'MAT ids missing from models query', {
        readPath: 'mat_ids_chunked',
        agencyId: aid,
        modelIds: matNotLoaded.slice(0, 24),
        totalMissing: matNotLoaded.length,
      });
    }
  }

  devAssertAgencyRosterMatchesEligibility(roster, matModelIds, aid, matLookupOk);
  return roster;
}

/**
 * Org-zentrische Variante: Models via model_assignments statt models.agency_id.
 * Gibt alle Models zurück, für die die Organization mindestens einen model_assignments-Eintrag hat.
 * Verwendet RLS — der Caller muss Mitglied der Organisation sein.
 */
export async function getModelsForOrganizationFromSupabase(
  organizationId: string,
): Promise<SupabaseModel[]> {
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
        .or(
          'agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link',
        )
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
  payload: { is_visible_commercial?: boolean; is_visible_fashion?: boolean },
): Promise<boolean> {
  try {
    const { error } = await agencyUpdateModelFullRpc({
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
      logger.error('models', 'claimModelByToken RPC failed', {
        message: error.message,
        code: (error as { code?: string }).code,
      });
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
): Promise<ServiceResult<{ token: string }>> {
  try {
    const trimmedOrg = organizationId?.trim();
    const { data, error } = await supabase.rpc('generate_model_claim_token', {
      p_model_id: modelId,
      ...(trimmedOrg ? { p_organization_id: trimmedOrg } : {}),
    });
    if (error) {
      console.error('generateModelClaimToken error:', error);
      logger.error('models', 'generateModelClaimToken RPC failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        hasOrgId: !!trimmedOrg,
      });
      return serviceErr(error.message ?? 'rpc_error');
    }
    if (!data) return serviceErr('no_token_returned');
    return serviceOkData({ token: data as string });
  } catch (e) {
    console.error('generateModelClaimToken exception:', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
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
  /** ISO territory codes (MAT) for this agency — one profile, many territories. */
  territories: string[];
  /** @deprecated Prefer `territories` — first code after sort, for legacy call sites */
  territory: string;
};

function aggregateModelAgencyRpcRows(raw: Array<Record<string, unknown>>): ModelAgencyContext[] {
  const byAgency = new Map<string, ModelAgencyContext>();
  for (const row of raw) {
    const modelId = row.model_id as string;
    const agencyId = row.agency_id as string;
    const agencyName = row.agency_name as string;
    const organizationId = (row.organization_id as string) ?? null;
    const code = String(row.territory ?? '')
      .trim()
      .toUpperCase();
    const existing = byAgency.get(agencyId);
    if (!existing) {
      const territories = code ? [code] : [];
      const territory = territories[0] ?? '';
      byAgency.set(agencyId, {
        modelId,
        agencyId,
        agencyName,
        organizationId,
        territories,
        territory,
      });
    } else {
      const t = new Set(existing.territories);
      if (code) t.add(code);
      const territories = [...t].sort();
      byAgency.set(agencyId, {
        ...existing,
        territories,
        territory: territories[0] ?? existing.territory,
      });
    }
  }
  return [...byAgency.values()].sort(
    (a, b) => a.agencyName.localeCompare(b.agencyName) || a.agencyId.localeCompare(b.agencyId),
  );
}

export async function getMyModelAgencies(): Promise<ModelAgencyContext[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_model_agencies');
    if (error) {
      console.error('getMyModelAgencies error:', error);
      return [];
    }
    if (!data || !Array.isArray(data)) return [];
    return aggregateModelAgencyRpcRows(data as Array<Record<string, unknown>>);
  } catch (e) {
    console.error('getMyModelAgencies exception:', e);
    return [];
  }
}

/** Canonical agency roster removal — resolves `agency_id` from the org row (multi-org safe). */
export type RemoveModelFromAgencyParams = {
  modelId: string;
  organizationId: string;
};

/**
 * Agency ends representation (soft delete): MAT cleared for this agency, model leaves roster &
 * client discovery when no territories remain; history kept in DB.
 * Always uses RPC `agency_remove_model` — never `agency_update_model_full`.
 */
export async function removeModelFromAgency(params: RemoveModelFromAgencyParams): Promise<boolean> {
  const modelId = params.modelId?.trim();
  const organizationId = params.organizationId?.trim();
  if (!modelId || !organizationId) {
    console.error('[agency_remove_model] failed', {
      modelId: params.modelId,
      error: 'missing_model_id_or_organization_id',
    });
    return false;
  }
  try {
    const { data: orgRow, error: orgErr } = await supabase
      .from('organizations')
      .select('agency_id, type')
      .eq('id', organizationId)
      .maybeSingle();

    if (orgErr) {
      console.error('[agency_remove_model] failed', { modelId, error: orgErr });
      return false;
    }

    const resolvedAgencyId = orgRow?.agency_id as string | null | undefined;
    if (!resolvedAgencyId || orgRow?.type !== 'agency') {
      console.error('[agency_remove_model] failed', {
        modelId,
        error: 'organization_not_agency_or_missing_agency_id',
      });
      return false;
    }

    const { data, error } = await supabase.rpc('agency_remove_model', {
      p_model_id: modelId,
      p_agency_id: resolvedAgencyId,
    });
    if (error) {
      console.error('[agency_remove_model] failed', { modelId, error });
      return false;
    }
    if (data !== true) {
      console.error('[agency_remove_model] failed', {
        modelId,
        error: 'rpc_returned_non_true',
        data,
      });
      return false;
    }

    try {
      const { data: modelRow } = await supabase
        .from('models')
        .select('user_id')
        .eq('id', modelId)
        .maybeSingle();
      const applicantUid = modelRow?.user_id as string | null | undefined;
      if (applicantUid) {
        const { data: staleApps, error: staleErr } = await supabase
          .from('model_applications')
          .select('id')
          .eq('applicant_user_id', applicantUid)
          .eq('accepted_by_agency_id', resolvedAgencyId)
          .in('status', ['accepted', 'pending_model_confirmation'])
          .limit(1);
        if (!staleErr && Array.isArray(staleApps) && staleApps.length > 0) {
          console.warn('[AGENCY_REMOVE_MODEL_NO_APPLICATION_SYNC]', {
            modelId,
            agencyId: resolvedAgencyId,
          });
        }
      }
    } catch (probeErr) {
      console.warn('[agency_remove_model] post-rpc application sync probe failed', probeErr);
    }

    void logAction(organizationId, 'removeModelFromAgency', {
      type: 'audit',
      action: 'model_removed',
      entityType: 'model',
      entityId: modelId,
      newData: { agencyId: resolvedAgencyId, endRepresentation: true },
    });
    return true;
  } catch (e) {
    console.error('[agency_remove_model] failed', { modelId, error: e });
    return false;
  }
}

/** Link a roster model to the model user who registered with this email (after API import etc.). */
export async function agencyLinkModelToUser(
  modelId: string,
  agencyId: string,
  email: string,
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

// ---------------------------------------------------------------------------
// External photo source (Mediaslide / Netwalk) — `models.photo_source` toggle
// ---------------------------------------------------------------------------

export type PhotoSource = 'own' | 'mediaslide' | 'netwalk';

export type ModelPhotoSourceContext = {
  /** Which set of photos the discovery / package layer should render. */
  photo_source: PhotoSource;
  /** External Mediaslide model id (when paired). */
  mediaslide_sync_id: string | null;
  /** External Netwalk model id (when paired). */
  netwalk_model_id: string | null;
  /** True when at least one external system is paired and selectable. */
  hasExternalLink: boolean;
};

/**
 * Read the current photo-source state for a single model.
 * Used by the agency media settings panel to decide whether to render the
 * "Use Mediaslide / Netwalk pictures" toggle and the "external pictures missing"
 * warning. Returns null when the row does not exist or RLS blocks the read.
 */
export async function getModelPhotoSourceContext(
  modelId: string,
): Promise<ModelPhotoSourceContext | null> {
  const id = modelId?.trim();
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from('models')
      .select('photo_source, mediaslide_sync_id, netwalk_model_id')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[getModelPhotoSourceContext] error:', error);
      return null;
    }
    if (!data) return null;
    const row = data as {
      photo_source?: string | null;
      mediaslide_sync_id?: string | null;
      netwalk_model_id?: string | null;
    };
    const raw = (row.photo_source ?? 'own') as string;
    const photo_source: PhotoSource = raw === 'mediaslide' || raw === 'netwalk' ? raw : 'own';
    return {
      photo_source,
      mediaslide_sync_id: row.mediaslide_sync_id ?? null,
      netwalk_model_id: row.netwalk_model_id ?? null,
      hasExternalLink: Boolean(row.mediaslide_sync_id) || Boolean(row.netwalk_model_id),
    };
  } catch (e) {
    console.error('[getModelPhotoSourceContext] exception:', e);
    return null;
  }
}

/**
 * Persist a new `photo_source` for a model via the SECURITY DEFINER RPC
 * `set_model_photo_source` (agency-scoped, writes audit log row).
 * Returns true on success.
 *
 * Setting `photo_source = 'own'` keeps `models.portfolio_images` / `polaroids`
 * pointing at this platform's `model_photos`. Setting `'mediaslide'` /
 * `'netwalk'` switches discovery / packages over to the URLs the next sync
 * pulled from the remote system.
 */
export async function setModelPhotoSource(modelId: string, source: PhotoSource): Promise<boolean> {
  const id = modelId?.trim();
  if (!id) return false;
  try {
    const { error } = await supabase.rpc('set_model_photo_source', {
      p_model_id: id,
      p_source: source,
    });
    if (error) {
      console.error('[setModelPhotoSource] RPC error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[setModelPhotoSource] exception:', e);
    return false;
  }
}

/**
 * True when the email matches a `profiles` row whose user is not the model's `user_id` (or model has no `user_id`).
 * Agency/booker scoped RPC — returns null if the check could not run (e.g. RPC missing).
 */
export async function agencyModelEmailMatchesUnlinkedProfile(
  modelId: string,
  email: string,
): Promise<boolean | null> {
  const mid = modelId?.trim();
  const em = email?.trim();
  if (!mid || !em) return false;
  try {
    const { data, error } = await supabase.rpc('agency_model_email_matches_unlinked_profile', {
      p_model_id: mid,
      p_email: em,
    });
    if (error) {
      console.error('agency_model_email_matches_unlinked_profile RPC error:', error);
      return null;
    }
    return data === true;
  } catch (e) {
    console.error('agencyModelEmailMatchesUnlinkedProfile exception:', e);
    return null;
  }
}
