/**
 * Agency workspace settings: public profile fields on `agencies`, name sync on `organizations`.
 * Update allowed by RLS only for organization role owner (see migration_agency_settings_and_model_photos_rls.sql).
 *
 * API key functions use SECURITY DEFINER RPCs (migration_agency_api_keys_rls.sql) so that
 * keys are never exposed via a broad SELECT on `agencies`.
 */
import { supabase } from '../../lib/supabase';

export type AgencyApiKeys = {
  mediaslide_api_key: string | null;
  netwalk_api_key: string | null;
  mediaslide_connected: boolean;
  netwalk_connected: boolean;
};

export type AgencySettingsPayload = {
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  country: string | null;
  agency_types: string[];
};

export async function updateAgencySettings(params: {
  agencyId: string;
  organizationId: string | null;
  payload: AgencySettingsPayload;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { agencyId, organizationId, payload } = params;
  try {
    const { error: aErr } = await supabase
      .from('agencies')
      .update({
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null,
        website: payload.website?.trim() || null,
        street: payload.street?.trim() || null,
        city: payload.city?.trim() || null,
        country: payload.country?.trim() || null,
        agency_types: payload.agency_types.filter(Boolean),
        updated_at: new Date().toISOString(),
      })
      .eq('id', agencyId);

    if (aErr) {
      console.error('updateAgencySettings agencies error:', aErr);
      return { ok: false, message: aErr.message || 'Could not save agency profile.' };
    }

    if (organizationId) {
      const { error: oErr } = await supabase
        .from('organizations')
        .update({ name: payload.name.trim() })
        .eq('id', organizationId);

      if (oErr) {
        console.error('updateAgencySettings organizations error:', oErr);
        return { ok: false, message: oErr.message || 'Could not sync organization name.' };
      }
    }

    return { ok: true };
  } catch (e) {
    console.error('updateAgencySettings exception:', e);
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Reads Mediaslide and Netwalk API keys for an agency via SECURITY DEFINER RPC.
 * Returns null if the caller is not an owner/booker of the agency.
 */
export async function getAgencyApiKeys(agencyId: string): Promise<AgencyApiKeys | null> {
  try {
    const { data, error } = await supabase.rpc('get_agency_api_keys', {
      p_agency_id: agencyId,
    });
    if (error) {
      console.error('getAgencyApiKeys error:', error);
      return null;
    }
    // RPC returns an array of rows; take the first.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      mediaslide_api_key: row.mediaslide_api_key ?? null,
      netwalk_api_key: row.netwalk_api_key ?? null,
      mediaslide_connected: row.mediaslide_connected ?? false,
      netwalk_connected: row.netwalk_connected ?? false,
    };
  } catch (e) {
    console.error('getAgencyApiKeys exception:', e);
    return null;
  }
}

/**
 * Saves a Mediaslide or Netwalk API key for an agency via SECURITY DEFINER RPC.
 * Only callable by the agency organisation owner.
 * Pass apiKey = null to disconnect the provider.
 */
export async function saveAgencyApiConnection(
  agencyId: string,
  provider: 'mediaslide' | 'netwalk',
  apiKey: string | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await supabase.rpc('save_agency_api_connection', {
      p_agency_id: agencyId,
      p_provider: provider,
      p_api_key: apiKey,
    });
    if (error) {
      console.error('saveAgencyApiConnection error:', error);
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('saveAgencyApiConnection exception:', e);
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' };
  }
}
