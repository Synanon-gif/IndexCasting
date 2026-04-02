import { supabase } from '../../lib/supabase';

/**
 * Gast-Links (Agentur) – in Supabase, pro agency_id; guest_links inkl. model_ids.
 * Alle Daten pro Partei gespeichert und abrufbar.
 */
export type PackageType = 'portfolio' | 'polaroid';

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
  /** 'portfolio' = portfolio images only; 'polaroid' = polaroids only. */
  type: PackageType;
  created_at: string;
  /** Soft-delete timestamp. Non-null means the link has been deleted.
   *  Kept in DB so existing chat-metadata packageId references remain resolvable. */
  deleted_at: string | null;
};

export async function createGuestLink(params: {
  agency_id: string;
  model_ids: string[];
  agency_email?: string;
  agency_name?: string;
  label?: string;
  expires_at?: string;
  /** 'portfolio' shows portfolio images only; 'polaroid' shows polaroids only. */
  type: PackageType;
}): Promise<GuestLink | null> {
  try {
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
        type: params.type,
      })
      .select()
      .single();
    if (error) { console.error('createGuestLink error:', error); return null; }
    return data as GuestLink;
  } catch (e) {
    console.error('createGuestLink exception:', e);
    return null;
  }
}

/**
 * Minimal link metadata shape returned by the get_guest_link_info RPC.
 * Does NOT include agency_id or model_ids — prevents enumeration by anon callers.
 */
export type GuestLinkInfo = Pick<
  GuestLink,
  'id' | 'label' | 'agency_name' | 'type' | 'is_active' | 'expires_at' | 'tos_accepted_by_guest'
>;

/**
 * Fetches display-safe metadata for a single active guest link via a
 * SECURITY DEFINER RPC (C-3 security fix). Safe for anon callers.
 * Returns null if the link is invalid, expired, or inactive.
 */
export async function getGuestLink(linkId: string): Promise<GuestLinkInfo | null> {
  try {
    const { data, error } = await supabase.rpc('get_guest_link_info', {
      p_link_id: linkId,
    });
    if (error) { console.error('getGuestLink RPC error:', error); return null; }
    if (!data || (data as GuestLinkInfo[]).length === 0) return null;
    return (data as GuestLinkInfo[])[0] ?? null;
  } catch (e) {
    console.error('getGuestLink exception:', e);
    return null;
  }
}

export async function getGuestLinksForAgency(agencyId: string): Promise<GuestLink[]> {
  try {
    const { data, error } = await supabase
      .from('guest_links')
      .select('*')
      .eq('agency_id', agencyId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) { console.error('getGuestLinksForAgency error:', error); return []; }
    return (data ?? []) as GuestLink[];
  } catch (e) {
    console.error('getGuestLinksForAgency exception:', e);
    return [];
  }
}

export async function deactivateGuestLink(linkId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('guest_links')
      .update({ is_active: false })
      .eq('id', linkId);
    if (error) { console.error('deactivateGuestLink error:', error); return false; }
    return true;
  } catch (e) {
    console.error('deactivateGuestLink exception:', e);
    return false;
  }
}

/**
 * Soft-deletes a guest link by setting deleted_at to the current timestamp.
 *
 * Hard DELETE is intentionally avoided: existing chat-metadata references
 * (BookingChatMetadata.packageId) remain resolvable so older conversations do
 * not break. The RLS policy and getGuestLinksForAgency filter out deleted rows
 * for normal reads (WHERE deleted_at IS NULL).
 */
export async function deleteGuestLink(linkId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('guest_links')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', linkId)
      .is('deleted_at', null);
    if (error) { console.error('deleteGuestLink error:', error); return false; }
    return true;
  } catch (e) {
    console.error('deleteGuestLink exception:', e);
    return false;
  }
}

/**
 * Minimal model shape returned by the get_guest_link_models RPC.
 * Contains only the fields needed by GuestView — no sensitive internal data.
 * Private photos are never included. Image arrays are mutually exclusive:
 *   Portfolio package → portfolio_images populated, polaroids = []
 *   Polaroid package  → polaroids populated, portfolio_images = []
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
  polaroids: string[];
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
