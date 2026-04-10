import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import { extractBucketAndPath } from '../storage/storageUrl';
import { serviceErr, serviceOkData, type ServiceResult } from '../types/serviceResult';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';

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
  /**
   * Timestamp of the first get_guest_link_models() call (first time models were loaded).
   * NULL = link was never opened. Once set, the 7-day access window applies.
   * Set server-side only inside the SECURITY DEFINER RPC.
   */
  first_accessed_at: string | null;
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
 * PostgREST may return TABLE RPC rows as a JSON array or a single object when one row.
 * Normalise so we always read the first logical row.
 */
function firstGuestLinkInfoRow(data: unknown): GuestLinkInfo | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const row = data[0] as GuestLinkInfo | undefined;
    return row ?? null;
  }
  if (typeof data === 'object' && data !== null && 'id' in data) {
    return data as GuestLinkInfo;
  }
  return null;
}

/**
 * Fetches display-safe metadata for a single active guest link via a
 * SECURITY DEFINER RPC (C-3 security fix). Safe for anon callers.
 * Returns null if the link is invalid, expired, or inactive.
 */
export async function getGuestLink(linkId: string): Promise<GuestLinkInfo | null> {
  const trimmed = linkId?.trim();
  if (!trimmed) return null;
  const idPrefix = trimmed.length >= 8 ? `${trimmed.slice(0, 8)}…` : trimmed;
  try {
    const { data, error } = await supabase.rpc('get_guest_link_info', {
      p_link_id: trimmed,
    });
    if (error) {
      const e = error as { code?: string; message?: string; details?: string; hint?: string };
      const code = e.code;
      const msg = e.message ?? '';
      console.error('[getGuestLink] rpc=get_guest_link_info', {
        p_link_id_prefix: idPrefix,
        code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      });
      if (code === 'PGRST202' || /not find.*function/i.test(msg) || /404/.test(msg)) {
        console.error(
          'getGuestLink: get_guest_link_info RPC missing or not exposed — deploy supabase/migrations (20260522_get_guest_link_info_ensure.sql)',
        );
      }
      return null;
    }
    return firstGuestLinkInfoRow(data);
  } catch (e) {
    console.error('[getGuestLink] exception', { p_link_id_prefix: idPrefix, err: e });
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
 *   Polaroid URLs may come from models.polaroids mirror or, when empty, visible
 *   polaroid rows in model_photos (get_guest_link_models RPC).
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
  /** Canonical city from model_locations (live>current>agency). NULL when no model_locations row exists. */
  effective_city?: string | null;
};

// Signed-URL TTL for guest-visible model images (M-3 fix, Security Audit 2026-04).
// After a guest link expires or is deactivated, previously seen raw public-bucket
// URLs would remain permanently accessible. By rewriting image URLs to signed URLs
// with a TTL at fetch time, newly-loaded sessions receive URLs that expire,
// limiting exposure without breaking the in-session UX.
//
// TTL aligned with the 7-day access window (20260406 update):
//   - Guest links give 7 days of access from first open.
//   - Signed URLs therefore use the same 7-day TTL so images stay accessible
//     for the full duration without requiring in-session re-fetching.
//   - If a link is deactivated (is_active = false), the RPC stops returning
//     models; any previously loaded signed URLs become unreachable from the
//     app (GuestView checks the link every 60 s and shows an error).
//   - Full mitigation (making documentspictures bucket fully private so expired
//     signed URLs become truly inaccessible from outside the app) is tracked
//     as a separate infrastructure migration.
//
// GuestView also auto-refreshes signed URLs every 6 hours as a safety net for
// long-lived sessions (see GuestView.tsx refreshSignedUrls interval).
const GUEST_IMAGE_SIGNED_TTL_SECONDS = 604_800; // 7 days
const DOCUMENTSPICTURES_BUCKET = 'documentspictures';

/**
 * Extracts the storage object path from any supported URL / URI format:
 *   - supabase-storage://documentspictures/path  (canonical new form)
 *   - https://…/object/public/documentspictures/path  (legacy public URL)
 * Returns null when the URL cannot be parsed or does not belong to the bucket.
 */
function extractStoragePath(url: string, bucket: string): string | null {
  const extracted = extractBucketAndPath(url);
  if (!extracted || extracted.bucket !== bucket) return null;
  return extracted.path || null;
}

/**
 * Rewrites an array of storage image URLs to signed URLs with a short TTL.
 * Returns null for any URL that cannot be signed (bucket is private — a public
 * fallback would expose the asset permanently, defeating the TTL).
 * Callers must handle null entries (e.g. hide the image or show a placeholder).
 */
async function signImageUrls(
  urls: string[],
  modelId: string,
): Promise<(string | null)[]> {
  if (urls.length === 0) return urls;
  return Promise.all(
    urls.map(async (url) => {
      const normalized = normalizeDocumentspicturesModelImageRef(url, modelId);
      const path = extractStoragePath(normalized, DOCUMENTSPICTURES_BUCKET);
      if (!path) {
        const passthrough = normalized.trim();
        if (passthrough.startsWith('https://') || passthrough.startsWith('http://')) {
          return passthrough;
        }
        return null;
      }
      try {
        const { data, error } = await supabase.storage
          .from(DOCUMENTSPICTURES_BUCKET)
          .createSignedUrl(path, GUEST_IMAGE_SIGNED_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          console.warn('signImageUrls: could not sign URL, omitting (bucket is private)', { path, error });
          return null;
        }
        return data.signedUrl;
      } catch (e) {
        console.warn('signImageUrls: exception signing URL, omitting', { path, error: e });
        return null;
      }
    }),
  );
}

/**
 * Fetches the models for an active guest link via a SECURITY DEFINER RPC.
 * Safe for anon callers — the RPC enforces the is_active + expiry guard.
 *
 * Returns {@link ServiceResult}: on failure callers must not treat as an empty package.
 *
 * M-3 fix (Security Audit 2026-04): image URLs are rewritten to signed URLs
 * so that links acquired in this session expire after the TTL rather than
 * remaining permanently accessible via public-bucket URLs.
 * 20260406: TTL increased from 15 min to 7 days to match the guest-link
 * access window. GuestView auto-refreshes every 6 h for long-lived sessions.
 */
export async function getGuestLinkModels(
  linkId: string,
): Promise<ServiceResult<GuestLinkModel[]>> {
  const trimmed = linkId?.trim() ?? '';
  if (!trimmed) {
    return serviceErr(uiCopy.b2bChat.packageModelsLoadFailed);
  }
  const idPrefix = trimmed.length >= 8 ? `${trimmed.slice(0, 8)}…` : trimmed;

  let hasSession = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    hasSession = !!session;
  } catch {
    // non-fatal for diagnostics
  }

  // Introspect client only (no env.ts import — keeps Jest from loading expo-constants).
  const sc = supabase as unknown as { supabaseUrl?: string; supabaseKey?: string };
  let supabaseHost = '(unknown)';
  try {
    supabaseHost = new URL(sc.supabaseUrl || 'https://invalid.local').host;
  } catch {
    supabaseHost = '(parse-error)';
  }
  const hasNonEmptyAnonKey =
    typeof sc.supabaseKey === 'string' && sc.supabaseKey.trim().length > 0;
  const looksLikePlaceholderSupabaseUrl = (sc.supabaseUrl ?? '').includes('placeholder.supabase.co');

  const diag = () => ({
    p_link_id_prefix: idPrefix,
    supabaseHost,
    hasNonEmptyAnonKey,
    looksLikePlaceholderSupabaseUrl,
    hasSession,
  });

  try {
    const { data, error } = await supabase.rpc('get_guest_link_models', {
      p_link_id: trimmed,
    });
    if (error) {
      const e = error as { code?: string; message?: string; details?: string; hint?: string };
      console.error('[getGuestLinkModels] rpc=get_guest_link_models', {
        ...diag(),
        code: e.code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      });
      return serviceErr(uiCopy.b2bChat.packageModelsLoadFailed);
    }
    const models = (data ?? []) as GuestLinkModel[];

    // Guest link access is logged server-side inside the get_guest_link_models()
    // SECURITY DEFINER RPC (migration_m3_m4_fixes.sql). No client-side insert
    // needed — the RPC is the single authoritative audit source.

    // Rewrite image arrays to signed URLs (M-3 fix).
    // signImageUrls returns null for any URL that cannot be signed;
    // filter those out rather than falling back to public URLs.
    const signed = await Promise.all(
      models.map(async (m) => ({
        ...m,
        portfolio_images: (await signImageUrls(m.portfolio_images, m.id)).filter((u): u is string => u !== null),
        polaroids:        (await signImageUrls(m.polaroids, m.id)).filter((u): u is string => u !== null),
      })),
    );
    return serviceOkData(signed);
  } catch (e) {
    console.error('[getGuestLinkModels] exception', { ...diag(), err: e });
    return serviceErr(uiCopy.b2bChat.packageModelsLoadFailed);
  }
}

/**
 * Auditable guest link revocation via SECURITY DEFINER RPC.
 * Verifies caller belongs to the owning agency, logs unauthorized attempts
 * as security_events, and creates an audit_trail entry on success.
 * Prefer this over deleteGuestLink() for audit-sensitive contexts.
 */
export async function revokeGuestAccess(linkId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('revoke_guest_access', {
      p_link_id: linkId,
    });
    if (error) {
      console.error('revokeGuestAccess error:', error);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error('revokeGuestAccess exception:', e);
    return false;
  }
}

/**
 * Records the guest's acceptance of ToS/Privacy for a specific link.
 * Uses a SECURITY DEFINER RPC so that the anon role can write this field
 * without broad UPDATE permissions on guest_links.
 */
export async function acceptGuestLinkTos(linkId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('accept_guest_link_tos', {
      p_link_id: linkId,
    });
    if (error) {
      console.error('acceptGuestLinkTos error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('acceptGuestLinkTos exception:', e);
    return false;
  }
}

export function buildGuestUrl(linkId: string): string {
  if (typeof window !== 'undefined') {
    const base = window.location.origin + (window.location.pathname || '');
    return `${base}?guest=${linkId}`;
  }
  return `https://indexcasting.com?guest=${linkId}`;
}
