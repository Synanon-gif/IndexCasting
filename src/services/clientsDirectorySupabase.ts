/**
 * Client profile directory for agencies (bidirectional connection requests).
 * Always loads the full matching result set from Supabase (paginated), not a fixed row cap.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllSupabasePages } from './supabaseFetchAll';

export type ClientDirectoryRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  company_name: string | null;
};

/**
 * All client-role profiles matching the optional search string (name / email / company).
 * Empty search = every client profile (paginated across the full table).
 */
export async function searchClientProfilesForAgency(search: string): Promise<ClientDirectoryRow[]> {
  try {
    const s = search.trim();
    if (s.length > 0) {
      const esc = s.replace(/%/g, '\\%').replace(/_/g, '\\_');
      return fetchAllSupabasePages(async (from, to) => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, display_name, email, company_name')
          .eq('role', 'client')
          .or(`display_name.ilike.%${esc}%,email.ilike.%${esc}%,company_name.ilike.%${esc}%`)
          .order('display_name', { ascending: true })
          .range(from, to);
        return { data: data as ClientDirectoryRow[] | null, error };
      });
    }
    return fetchAllSupabasePages(async (from, to) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, email, company_name')
        .eq('role', 'client')
        .order('display_name', { ascending: true })
        .range(from, to);
      return { data: data as ClientDirectoryRow[] | null, error };
    });
  } catch (e) {
    console.error('searchClientProfilesForAgency exception:', e);
    return [];
  }
}
