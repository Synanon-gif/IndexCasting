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
  created_at?: string;
  updated_at?: string;
};

export async function getAgencies(): Promise<Agency[]> {
  return fetchAllSupabasePages(async (from, to) => {
    const { data, error } = await supabase
      .from('agencies')
      .select('id, name, city, focus, email, code, logo_url, created_at, updated_at')
      .order('name')
      .range(from, to);
    return { data: data as Agency[] | null, error };
  });
}

export async function getAgencyById(id: string): Promise<Agency | null> {
  const { data, error } = await supabase
    .from('agencies')
    .select('id, name, city, focus, email, code, logo_url, created_at, updated_at')
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
