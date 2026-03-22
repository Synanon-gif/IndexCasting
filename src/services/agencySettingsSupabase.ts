/**
 * Agency workspace settings: public profile fields on `agencies`, name sync on `organizations`.
 * Update allowed by RLS only for organization role owner (see migration_agency_settings_and_model_photos_rls.sql).
 */
import { supabase } from '../../lib/supabase';

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
