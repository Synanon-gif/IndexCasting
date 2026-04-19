/**
 * Other agency *organizations* discoverable by agency users for B2B
 * agency_to_agency invoice recipient picker. Backed by
 * list_agency_organizations_for_agency_directory (SECURITY DEFINER).
 *
 * Excludes the caller's own agency. Service uses identical shape and
 * Option-A contract as listClientOrganizationsForAgencyDirectory.
 */
import { supabase } from '../../lib/supabase';

export type AgencyOrganizationDirectoryRow = {
  id: string;
  name: string;
  organization_type: string;
};

export async function listAgencyOrganizationsForAgencyDirectory(
  agencyId: string,
  search: string,
): Promise<AgencyOrganizationDirectoryRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_agency_organizations_for_agency_directory', {
      p_agency_id: agencyId,
      p_search: search.trim(),
    });
    if (error) {
      console.error('list_agency_organizations_for_agency_directory error:', error);
      return [];
    }
    const j = data as { ok?: boolean; rows?: AgencyOrganizationDirectoryRow[]; error?: string };
    if (!j?.ok || !Array.isArray(j.rows)) return [];
    return j.rows;
  } catch (e) {
    console.error('listAgencyOrganizationsForAgencyDirectory exception:', e);
    return [];
  }
}
