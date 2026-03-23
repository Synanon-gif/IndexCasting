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
  // First, delete territories for this model/agency that are not in the new list
  const { error: deleteError } = await supabase
    .from('model_agency_territories')
    .delete()
    .eq('model_id', modelId)
    .eq('agency_id', agencyId)
    .not('country_code', 'in', `(${countryCodes.map((c) => `'${c}'`).join(',') || "''"})`);

  if (deleteError) {
    console.error('upsertTerritoriesForModel delete error:', deleteError);
  }

  if (countryCodes.length === 0) {
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

  const payload = countryCodes.map((code) => ({
    model_id: modelId,
    agency_id: agencyId,
    country_code: code,
  }));

  const { data, error } = await supabase
    .from('model_agency_territories')
    .upsert(payload, { onConflict: 'model_id,country_code,agency_id' })
    .select('*')
    .order('country_code');

  if (error) {
    console.error('upsertTerritoriesForModel upsert error:', error);
    return [];
  }

  return (data ?? []) as ModelTerritory[];
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
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('resolveAgencyForModelAndCountry error:', error);
      return null;
    }
    const row = (data ?? []) as Array<{ agency_id: string }> | null;
    return row?.[0]?.agency_id ?? null;
  } catch (e) {
    console.error('resolveAgencyForModelAndCountry exception:', e);
    return null;
  }
}

