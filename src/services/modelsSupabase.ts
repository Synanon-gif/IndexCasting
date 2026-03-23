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
  created_at?: string;
  updated_at?: string;
};

export async function getModelsFromSupabase(): Promise<SupabaseModel[]> {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .order('name');

  if (error) {
    console.error('getModelsFromSupabase error:', error);
    return [];
  }
  return (data ?? []) as SupabaseModel[];
}

/** Ein Model, das dem eingeloggten User zugeordnet ist (user_id oder E-Mail-Link). */
export async function getModelForUserFromSupabase(userId: string): Promise<SupabaseModel | null> {
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
}

export async function getModelByIdFromSupabase(id: string): Promise<SupabaseModel | null> {
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
}

export async function getModelsForClientFromSupabase(
  clientType: 'fashion' | 'commercial'
): Promise<SupabaseModel[]> {
  const column = clientType === 'fashion' ? 'is_visible_fashion' : 'is_visible_commercial';
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .eq(column, true)
      .or('agency_relationship_status.is.null,agency_relationship_status.eq.active,agency_relationship_status.eq.pending_link')
      .order('name')
      .range(from, to);
    return { data: data as SupabaseModel[] | null, error };
  });
}

export async function getModelsForClientFromSupabaseByTerritory(
  clientType: 'fashion' | 'commercial',
  countryCode: string,
): Promise<
  Array<SupabaseModel & { country_code: string; agency_name: string; territory_agency_id?: string | null }>
> {
  const iso = countryCode.trim().toUpperCase();
  const column = clientType === 'fashion' ? 'is_visible_fashion' : 'is_visible_commercial';
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('models_with_territories')
      .select('*')
      .eq('country_code', iso)
      .eq(column, true)
      .order('name')
      .range(from, to);
    return {
      data: data as Array<
        SupabaseModel & { country_code: string; agency_name: string; territory_agency_id?: string | null }
      > | null,
      error,
    };
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
