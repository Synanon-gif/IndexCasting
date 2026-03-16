import { supabase } from '../../lib/supabase';

/**
 * Gast-Links (Agentur) – in Supabase, pro agency_id; guest_links inkl. model_ids.
 * Alle Daten pro Partei gespeichert und abrufbar.
 */
export type GuestLink = {
  id: string;
  agency_id: string;
  model_ids: string[];
  agency_email: string | null;
  agency_name: string | null;
  created_by: string | null;
  expires_at: string | null;
  is_active: boolean;
  tos_accepted_by_guest: boolean;
  created_at: string;
};

export async function createGuestLink(params: {
  agency_id: string;
  model_ids: string[];
  agency_email?: string;
  agency_name?: string;
  expires_at?: string;
}): Promise<GuestLink | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('guest_links')
    .insert({
      agency_id: params.agency_id,
      model_ids: params.model_ids,
      agency_email: params.agency_email || null,
      agency_name: params.agency_name || null,
      created_by: user?.id || null,
      expires_at: params.expires_at || null,
    })
    .select()
    .single();
  if (error) { console.error('createGuestLink error:', error); return null; }
  return data as GuestLink;
}

export async function getGuestLink(linkId: string): Promise<GuestLink | null> {
  const { data, error } = await supabase
    .from('guest_links')
    .select('*')
    .eq('id', linkId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) { console.error('getGuestLink error:', error); return null; }
  if (data?.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data as GuestLink | null;
}

export async function getGuestLinksForAgency(agencyId: string): Promise<GuestLink[]> {
  const { data, error } = await supabase
    .from('guest_links')
    .select('*')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getGuestLinksForAgency error:', error); return []; }
  return (data ?? []) as GuestLink[];
}

export async function deactivateGuestLink(linkId: string): Promise<boolean> {
  const { error } = await supabase
    .from('guest_links')
    .update({ is_active: false })
    .eq('id', linkId);
  if (error) { console.error('deactivateGuestLink error:', error); return false; }
  return true;
}

export function buildGuestUrl(linkId: string): string {
  if (typeof window !== 'undefined') {
    const base = window.location.origin + (window.location.pathname || '');
    return `${base}?guest=${linkId}`;
  }
  return `https://app.castingindex.com?guest=${linkId}`;
}
