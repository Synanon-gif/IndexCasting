import { supabase } from '../../lib/supabase';
import { fetchAllSupabasePages } from './supabaseFetchAll';

/**
 * Client ↔ Agency connections (`client_agency_connections`).
 * Optional: `from_organization_id`, `to_organization_id`, `conversation_id`, `created_by`.
 */

export type SupabaseConnection = {
  id: string;
  client_id: string;
  agency_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  requested_by: 'client' | 'agency';
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  from_organization_id?: string | null;
  to_organization_id?: string | null;
  conversation_id?: string | null;
};

export type ConnectionInsertPayload = {
  clientId: string;
  agencyId: string;
  requestedBy: 'client' | 'agency';
  createdBy?: string | null;
  fromOrganizationId?: string | null;
  toOrganizationId?: string | null;
};

export async function getConnectionsForClient(clientId: string): Promise<SupabaseConnection[]> {
  try {
    return await fetchAllSupabasePages(async (from, to) => {
      const { data, error } = await supabase
        .from('client_agency_connections')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(from, to);
      return { data: data as SupabaseConnection[] | null, error };
    });
  } catch (e) {
    console.error('getConnectionsForClient exception:', e);
    return [];
  }
}

export async function getConnectionsForAgency(agencyId: string): Promise<SupabaseConnection[]> {
  try {
    return await fetchAllSupabasePages(async (from, to) => {
      const { data, error } = await supabase
        .from('client_agency_connections')
        .select('*')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false })
        .range(from, to);
      return { data: data as SupabaseConnection[] | null, error };
    });
  } catch (e) {
    console.error('getConnectionsForAgency exception:', e);
    return [];
  }
}

/** @deprecated Prefer getConnectionsForClient / getConnectionsForAgency (RLS-scoped). */
export async function getAllConnections(): Promise<SupabaseConnection[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('client_agency_connections')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);
    return { data: data as SupabaseConnection[] | null, error };
  });
}

/** Single row for a client–agency pair (authoritative duplicate check vs in-memory cache). */
export async function getConnectionByClientAndAgency(
  clientId: string,
  agencyId: string
): Promise<SupabaseConnection | null> {
  try {
    const { data, error } = await supabase
      .from('client_agency_connections')
      .select('*')
      .eq('client_id', clientId)
      .eq('agency_id', agencyId)
      .maybeSingle();
    if (error) {
      console.error('getConnectionByClientAndAgency error:', error);
      return null;
    }
    return (data ?? null) as SupabaseConnection | null;
  } catch (e) {
    console.error('getConnectionByClientAndAgency exception:', e);
    return null;
  }
}

export async function insertConnection(payload: ConnectionInsertPayload): Promise<SupabaseConnection | null> {
  try {
    const row: Record<string, unknown> = {
      client_id: payload.clientId,
      agency_id: payload.agencyId,
      status: 'pending',
      requested_by: payload.requestedBy,
    };
    if (payload.createdBy) row.created_by = payload.createdBy;
    if (payload.fromOrganizationId) row.from_organization_id = payload.fromOrganizationId;
    if (payload.toOrganizationId) row.to_organization_id = payload.toOrganizationId;

    const { data, error } = await supabase.from('client_agency_connections').insert(row).select('*').single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        console.warn('insertConnection: duplicate client/agency pair');
        return null;
      }
      console.error('insertConnection error:', error);
      return null;
    }
    return data as SupabaseConnection;
  } catch (e) {
    console.error('insertConnection exception:', e);
    return null;
  }
}

export async function updateConnectionStatus(
  id: string,
  status: 'accepted' | 'rejected'
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('client_agency_connections')
      .update({ status })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('updateConnectionStatus error:', error);
      return false;
    }
    if (!data?.id) {
      console.warn('updateConnectionStatus: no row updated', id);
      return false;
    }
    return true;
  } catch (e) {
    console.error('updateConnectionStatus exception:', e);
    return false;
  }
}

export async function setConnectionConversationId(connectionId: string, conversationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('client_agency_connections')
      .update({ conversation_id: conversationId })
      .eq('id', connectionId);
    if (error) {
      console.error('setConnectionConversationId error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('setConnectionConversationId exception:', e);
    return false;
  }
}

export async function deleteConnection(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('client_agency_connections').delete().eq('id', id);
    if (error) {
      console.error('deleteConnection error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deleteConnection exception:', e);
    return false;
  }
}

const PROFILE_IN_CHUNK = 200;

/** Display names for connection list (batch; chunked so large orgs still resolve every user). */
export async function getProfileDisplayNamesForUserIds(
  userIds: string[]
): Promise<Record<string, string>> {
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (uniq.length === 0) return {};
  const map: Record<string, string> = {};
  try {
    for (let i = 0; i < uniq.length; i += PROFILE_IN_CHUNK) {
      const chunk = uniq.slice(i, i + PROFILE_IN_CHUNK);
      const { data, error } = await supabase.from('profiles').select('id, display_name, email').in('id', chunk);
      if (error) {
        console.error('getProfileDisplayNamesForUserIds error:', error);
        continue;
      }
      for (const p of data ?? []) {
        const row = p as { id: string; display_name: string | null; email: string | null };
        map[row.id] = row.display_name?.trim() || row.email?.trim() || row.id.slice(0, 8);
      }
    }
    return map;
  } catch (e) {
    console.error('getProfileDisplayNamesForUserIds exception:', e);
    return map;
  }
}
