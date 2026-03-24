/**
 * Agenturen – alle Stammdaten in Supabase (agencies); zentrale Datenquelle für die App.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllSupabasePages } from './supabaseFetchAll';

export type Agency = {
  id: string;
  name: string;
  city: string | null;
  focus: string | null;
  email: string | null;
  code?: string | null;
  logo_url?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  street?: string | null;
  country?: string | null;
  /** Marketing segments (Fashion, High Fashion, Commercial). */
  agency_types?: string[] | null;
  created_at?: string;
  updated_at?: string;
};

/**
 * Creates public.agencies for the current agent email if missing (SECURITY DEFINER RPC).
 * Do not call for invited bookers — use only when starting a new agency (no invite acceptance).
 */
export async function ensureAgencyRecordForCurrentAgent(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('ensure_agency_for_current_agent');
    if (error) {
      console.error('ensureAgencyRecordForCurrentAgent error:', error);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (e) {
    console.error('ensureAgencyRecordForCurrentAgent exception:', e);
    return null;
  }
}

export async function getAgencies(options?: { overlapsAgencyTypes?: string[] }): Promise<Agency[]> {
  return fetchAllSupabasePages(async (from, to) => {
    let q = supabase
      .from('agencies')
      .select(
        'id, name, city, focus, email, code, logo_url, description, phone, website, street, country, agency_types, created_at, updated_at'
      )
      .order('name');
    if (options?.overlapsAgencyTypes?.length) {
      // Agencies with NULL or empty agency_types are "uncategorised" → visible in ALL filters.
      // Build an OR that explicitly includes them alongside the overlap check.
      const escaped = options.overlapsAgencyTypes.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',');
      q = q.or(`agency_types.is.null,agency_types.eq.{},agency_types.ov.{${escaped}}`);
    }
    const { data, error } = await q.range(from, to);
    return { data: data as Agency[] | null, error };
  });
}

export async function getAgencyById(id: string): Promise<Agency | null> {
  const { data, error } = await supabase
    .from('agencies')
    .select(
      'id, name, city, focus, email, code, logo_url, description, phone, website, street, country, agency_types, created_at, updated_at'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('getAgencyById error:', error);
    return null;
  }
  return (data ?? null) as Agency | null;
}

/** Nur Anzeigefelder für Model-Chat-Header (keine Mail, Adresse, API-Keys). */
export async function getAgencyChatDisplayById(id: string): Promise<{ name: string; logo_url: string | null } | null> {
  try {
    const { data, error } = await supabase.from('agencies').select('name, logo_url').eq('id', id).maybeSingle();
    if (error) {
      console.error('getAgencyChatDisplayById error:', error);
      return null;
    }
    if (!data?.name) return null;
    return { name: data.name, logo_url: data.logo_url ?? null };
  } catch (e) {
    console.error('getAgencyChatDisplayById exception:', e);
    return null;
  }
}
