/**
 * Client *organizations* discoverable by agency users (B2B — no individual profile search).
 * Backed by list_client_organizations_for_agency_directory (SECURITY DEFINER).
 */
import { supabase } from '../../lib/supabase';

export type ClientOrganizationDirectoryRow = {
  id: string;
  name: string;
  organization_type: string;
};

export async function listClientOrganizationsForAgencyDirectory(
  agencyId: string,
  search: string,
): Promise<ClientOrganizationDirectoryRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_client_organizations_for_agency_directory', {
      p_agency_id: agencyId,
      p_search: search.trim(),
    });
    if (error) {
      console.error('list_client_organizations_for_agency_directory error:', error);
      return [];
    }
    const j = data as { ok?: boolean; rows?: ClientOrganizationDirectoryRow[]; error?: string };
    if (!j?.ok || !Array.isArray(j.rows)) return [];
    return j.rows;
  } catch (e) {
    console.error('listClientOrganizationsForAgencyDirectory exception:', e);
    return [];
  }
}
