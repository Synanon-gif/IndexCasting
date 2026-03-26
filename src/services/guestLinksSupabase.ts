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
  label: string | null;
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
  label?: string;
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
      label: params.label || null,
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

/**
 * Minimal model shape returned by the get_guest_link_models RPC.
 * Contains only the fields needed by GuestView — no sensitive internal data.
 */
export type GuestLinkModel = {
  id: string;
  name: string;
  height: number | null;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  city: string | null;
  hair_color: string | null;
  eye_color: string | null;
  sex: string | null;
  portfolio_images: string[];
};

/**
 * Fetches the models for an active guest link via a SECURITY DEFINER RPC.
 * Safe for anon callers — the RPC enforces the is_active + expiry guard.
 * Returns [] if the link is invalid/expired or on error.
 */
export async function getGuestLinkModels(linkId: string): Promise<GuestLinkModel[]> {
  try {
    const { data, error } = await supabase.rpc('get_guest_link_models', {
      p_link_id: linkId,
    });
    if (error) {
      console.error('getGuestLinkModels RPC error:', error);
      return [];
    }
    return (data ?? []) as GuestLinkModel[];
  } catch (e) {
    console.error('getGuestLinkModels exception:', e);
    return [];
  }
}

export function buildGuestUrl(linkId: string): string {
  if (typeof window !== 'undefined') {
    const base = window.location.origin + (window.location.pathname || '');
    return `${base}?guest=${linkId}`;
  }
  return `https://app.castingindex.com?guest=${linkId}`;
}
