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
  created_at?: string;
  updated_at?: string;
};

export async function getAgencies(): Promise<Agency[]> {
  const { data, error } = await supabase
    .from('agencies')
    .select('id, name, city, focus, email, code, created_at, updated_at')
    .order('name');

  if (error) {
    console.error('getAgencies error:', error);
    return [];
  }
  return (data ?? []) as Agency[];
}
