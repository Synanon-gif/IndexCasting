import { supabase } from '../../lib/supabase';

/**
 * Legacy `bookers`-Tabelle (nur noch lesen, wo nötig).
 * Neue Team-Mitglieder: Einladungen über `organizations` / `organization_members`.
 */
export type Booker = {
  id: string;
  user_id: string | null;
  agency_id: string | null;
  client_id: string | null;
  display_name: string;
  email: string | null;
  bookings_completed: number;
  is_master: boolean;
  created_at: string;
  updated_at: string;
};

export async function getBookersForAgency(agencyId: string): Promise<Booker[]> {
  const { data, error } = await supabase
    .from('bookers')
    .select('id, user_id, agency_id, client_id, display_name, email, bookings_completed, is_master, created_at, updated_at')
    .eq('agency_id', agencyId)
    .order('display_name');
  if (error) {
    console.error('getBookersForAgency error:', error);
    return [];
  }
  return (data ?? []) as Booker[];
}

export async function getBookersForClient(clientId: string): Promise<Booker[]> {
  const { data, error } = await supabase
    .from('bookers')
    .select('id, user_id, agency_id, client_id, display_name, email, bookings_completed, is_master, created_at, updated_at')
    .eq('client_id', clientId)
    .order('display_name');
  if (error) {
    console.error('getBookersForClient error:', error);
    return [];
  }
  return (data ?? []) as Booker[];
}
