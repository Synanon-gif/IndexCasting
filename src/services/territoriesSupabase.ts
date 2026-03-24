import { supabase } from '../../lib/supabase';

/**
 * Model-Territorien (Agentur ↔ Model) – in Supabase: model_agency_territories.
 * Parteienübergreifend (model_id, agency_id); alle Daten persistent.
 */
export type ModelTerritory = {
  id: string;
  model_id: string;
  agency_id: string;
  country_code: string;
  created_at?: string;
};

export async function getTerritoriesForModel(modelId: string): Promise<ModelTerritory[]> {
  const { data, error } = await supabase
    .from('model_agency_territories')
    .select('*')
    .eq('model_id', modelId)
    .order('country_code');

  if (error) {
    console.error('getTerritoriesForModel error:', error);
    return [];
  }
  return (data ?? []) as ModelTerritory[];
}

export async function upsertTerritoriesForModel(
  modelId: string,
  agencyId: string,
  countryCodes: string[],
): Promise<ModelTerritory[]> {
  const normalized = Array.from(
    new Set(countryCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  );

  // First, delete territories for this model/agency that are not in the new list
  const { error: deleteError } = await supabase
    .from('model_agency_territories')
    .delete()
    .eq('model_id', modelId)
    .eq('agency_id', agencyId)
    .not(
      'country_code',
      'in',
      `(${normalized.map((c) => `'${c}'`).join(',') || "''"})`,
    );

  if (deleteError) {
    console.error('upsertTerritoriesForModel delete error:', deleteError);
    return [];
  }

  if (normalized.length === 0) {
    const { data, error } = await supabase
      .from('model_agency_territories')
      .select('*')
      .eq('model_id', modelId)
      .eq('agency_id', agencyId)
      .order('country_code');
    if (error) {
      console.error('upsertTerritoriesForModel fetch-after-empty error:', error);
      return [];
    }
    return (data ?? []) as ModelTerritory[];
  }

  const payload = normalized.map((code) => ({
    model_id: modelId,
    agency_id: agencyId,
    country_code: code,
  }));

  const { data, error } = await supabase
    .from('model_agency_territories')
    // With the stabilized schema: 1 agency per (model_id,country_code).
    // Conflict resolution updates `agency_id` for the country.
    .upsert(payload, { onConflict: 'model_id,country_code' })
    .select('*')
    .order('country_code');

  if (error) {
    console.error('upsertTerritoriesForModel upsert error:', error);
    return [];
  }

  return (data ?? []) as ModelTerritory[];
}

/**
 * Merge territory claims without deleting other countries.
 * Enforces stabilized uniqueness: 1 row per (model_id,country_code) updates agency_id.
 */
export async function upsertTerritoriesForModelCountryAgencyPairs(
  modelId: string,
  pairs: Array<{ country_code: string; agency_id: string }>,
): Promise<ModelTerritory[]> {
  const normalized = pairs
    .map((p) => ({
      country_code: p.country_code.trim().toUpperCase(),
      agency_id: p.agency_id,
    }))
    .filter((p) => Boolean(p.country_code) && Boolean(p.agency_id));

  // If multiple pairs are passed for the same country, keep the last one.
  const dedupByCountry = new Map<string, { country_code: string; agency_id: string }>();
  for (const p of normalized) dedupByCountry.set(p.country_code, p);

  const payload = Array.from(dedupByCountry.values()).map((p) => ({
    model_id: modelId,
    agency_id: p.agency_id,
    country_code: p.country_code,
  }));

  if (payload.length === 0) return [];

  const { data, error } = await supabase
    .from('model_agency_territories')
    .upsert(payload, { onConflict: 'model_id,country_code' })
    .select('*')
    .order('country_code');

  if (error) {
    console.error('upsertTerritoriesForModelCountryAgencyPairs error:', error);
    return [];
  }

  return (data ?? []) as ModelTerritory[];
}

/**
 * Bulk-assign territories to multiple models at once.
 * Applies the same country list to every model in the array.
 * Respects upsert semantics: existing territories for other agencies are not touched.
 */
export async function bulkUpsertTerritoriesForModels(
  modelIds: string[],
  agencyId: string,
  countryCodes: string[],
): Promise<{ succeededIds: string[]; failedIds: string[] }> {
  const succeededIds: string[] = [];
  const failedIds: string[] = [];

  for (const modelId of modelIds) {
    try {
      await upsertTerritoriesForModel(modelId, agencyId, countryCodes);
      // Success = no exception thrown. upsertTerritoriesForModel already logs Supabase
      // errors internally; an empty SELECT result due to RLS does not mean the UPSERT
      // failed — the row was written, the caller just cannot read it back.
      succeededIds.push(modelId);
    } catch (e) {
      console.error('bulkUpsertTerritoriesForModels error for model', modelId, e);
      failedIds.push(modelId);
    }
  }

  return { succeededIds, failedIds };
}

/**
 * Booking routing helper: pick the correct agency for a model + country.
 * - If multiple agencies exist for the same model+country, we pick the latest by `created_at`.
 * - Returns null when no matching territory exists.
 */
export async function resolveAgencyForModelAndCountry(
  modelId: string,
  countryCode: string,
): Promise<string | null> {
  const code = countryCode.trim().toUpperCase();
  if (!code) return null;

  try {
    const { data, error } = await supabase
      .from('model_agency_territories')
      .select('agency_id')
      .eq('model_id', modelId)
      .eq('country_code', code)
      .maybeSingle();

    if (error) {
      console.error('resolveAgencyForModelAndCountry error:', error);
      return null;
    }

    return (data as { agency_id: string } | null)?.agency_id ?? null;
  } catch (e) {
    console.error('resolveAgencyForModelAndCountry exception:', e);
    return null;
  }
}

