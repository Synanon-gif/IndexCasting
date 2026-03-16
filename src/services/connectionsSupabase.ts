import { supabase } from '../../lib/supabase';

/**
 * Verbindungen Kunde ↔ Agentur (client_agency_connections) – in Supabase.
 * Parteienübergreifend: client_id, agency_id, status; alle Daten persistent.
 */

export type SupabaseConnection = {
  id: string;
  client_id: string;
  agency_id: string;
  status: 'pending' | 'accepted';
  requested_by: 'client' | 'agency';
  created_at: string;
  updated_at: string;
};

export async function getConnectionsForClient(clientId: string): Promise<SupabaseConnection[]> {
  const { data, error } = await supabase
    .from('client_agency_connections')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getConnectionsForClient error:', error); return []; }
  return (data ?? []) as SupabaseConnection[];
}

export async function getConnectionsForAgency(agencyId: string): Promise<SupabaseConnection[]> {
  const { data, error } = await supabase
    .from('client_agency_connections')
    .select('*')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getConnectionsForAgency error:', error); return []; }
  return (data ?? []) as SupabaseConnection[];
}

export async function getAllConnections(): Promise<SupabaseConnection[]> {
  const { data, error } = await supabase
    .from('client_agency_connections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('getAllConnections error:', error); return []; }
  return (data ?? []) as SupabaseConnection[];
}

export async function insertConnection(
  clientId: string,
  agencyId: string,
  requestedBy: 'client' | 'agency'
): Promise<SupabaseConnection | null> {
  const { data, error } = await supabase
    .from('client_agency_connections')
    .insert({ client_id: clientId, agency_id: agencyId, status: 'pending', requested_by: requestedBy })
    .select()
    .single();
  if (error) { console.error('insertConnection error:', error); return null; }
  return data as SupabaseConnection;
}

export async function updateConnectionStatus(id: string, status: 'accepted'): Promise<boolean> {
  const { error } = await supabase
    .from('client_agency_connections')
    .update({ status })
    .eq('id', id);
  if (error) { console.error('updateConnectionStatus error:', error); return false; }
  return true;
}

export async function deleteConnection(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('client_agency_connections')
    .delete()
    .eq('id', id);
  if (error) { console.error('deleteConnection error:', error); return false; }
  return true;
}
