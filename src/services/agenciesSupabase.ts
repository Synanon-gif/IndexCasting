/**
 * Agenturen – alle Stammdaten in Supabase (agencies); zentrale Datenquelle für die App.
 */
import { supabase } from '../../lib/supabase';

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
  const { data, error } = await supabase
    .from('agencies')
    .select('id, name, city, focus, email, code, logo_url, created_at, updated_at')
    .order('name');

  if (error) {
    console.error('getAgencies error:', error);
    return [];
  }
  return (data ?? []) as Agency[];
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
