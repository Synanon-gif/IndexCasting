import { supabase } from '../../lib/supabase';
import { uiCopy } from '../constants/uiCopy';
import { extractBucketAndPath } from '../storage/storageUrl';
import { serviceErr, serviceOkData, type ServiceResult } from '../types/serviceResult';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';

/**
 * Gast-Links (Agentur) – in Supabase, pro agency_id; guest_links inkl. model_ids.
 * Alle Daten pro Partei gespeichert und abrufbar.
 *
 * Scope: external **package** access via `get_guest_link_*` RPCs only — not the same
 * code path as the public agency directory (`publicAgencyProfileSupabase.ts`).
 */
/**
 * Package kind for guest links and internal package gallery.
 * - 'portfolio' → portfolio_images only
 * - 'polaroid'  → polaroids only
 * - 'mixed'     → both portfolio_images AND polaroids; viewer toggles between
 *   the two on the client side (Portfolio/Polaroid switcher).
 *
 * Backed by `guest_links.type` CHECK constraint
 * (migration 20261020_guest_links_mixed_package_type.sql).
 */
export type PackageType = 'portfolio' | 'polaroid' | 'mixed';

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
  /**
   * 'portfolio' = portfolio images only;
   * 'polaroid'  = polaroids only;
   * 'mixed'     = both arrays populated; viewer chooses which to display.
   */
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
  /**
   * 'portfolio' shows portfolio images only; 'polaroid' shows polaroids only;
   * 'mixed' returns both arrays populated for client-side toggling.
   */
  type: PackageType;
}): Promise<GuestLink | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    if (error) {
      console.error('createGuestLink error:', error);
      return null;
    }
    return data as GuestLink;
  } catch (e) {
    console.error('createGuestLink exception:', e);
    return null;
  }
}

/**
 * Minimal link metadata shape returned by the get_guest_link_info RPC.
 * Does NOT include model_ids — prevents enumeration of model lists by anon callers.
 *
 * Includes `agency_id` (since 20261021) so authenticated client workspaces can
 * wire the "Chat with agency" CTA in the package gallery via
 * `ensureClientAgencyChat({ agencyId: gl.agency_id, ... })`. The link_id remains
 * the secret; the agency UUID is opaque and does not enable enumeration.
 */
export type GuestLinkInfo = Pick<
  GuestLink,
  | 'id'
  | 'label'
  | 'agency_id'
  | 'agency_name'
  | 'type'
  | 'is_active'
  | 'expires_at'
  | 'tos_accepted_by_guest'
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

/**
 * Resolves `agency organization_id` for a guest link via SECURITY DEFINER RPC
 * `get_agency_org_id_for_link`. Server validates active / non-expired / non-deleted link
 * (C-2). Never trust a client-supplied org id for guest context — use this instead.
 */
export async function getAgencyOrgIdForGuestLink(linkId: string): Promise<string | null> {
  const trimmed = linkId?.trim();
  if (!trimmed) return null;
  try {
    const { data, error } = await supabase.rpc('get_agency_org_id_for_link', {
      p_link_id: trimmed,
    });
    if (error) {
      console.error('getAgencyOrgIdForGuestLink error:', error);
      return null;
    }
    return (data as string | null) ?? null;
  } catch (e) {
    console.error('getAgencyOrgIdForGuestLink exception:', e);
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
    if (error) {
      console.error('getGuestLinksForAgency error:', error);
      return [];
    }
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
    if (error) {
      console.error('deactivateGuestLink error:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('deactivateGuestLink exception:', e);
    return false;
  }
}

/**
 * Soft-deletes a guest link by routing through the SECURITY DEFINER RPC
 * `revoke_guest_access`. The RPC enforces a 3-branch authorization that mirrors
 * the RLS policies on guest_links (org_member ∨ org_owner ∨ legacy bookers row)
 * and atomically sets `is_active = false, deleted_at = COALESCE(deleted_at, now())`.
 *
 * Hard DELETE is intentionally avoided: existing chat-metadata references
 * (BookingChatMetadata.packageId) remain resolvable so older conversations do
 * not break. RLS + getGuestLinksForAgency filter out deleted rows for normal reads.
 *
 * NOTE: A direct PostgREST UPDATE used to silently fail (0 rows updated, no
 * error) for callers that pass the SELECT but not the UPDATE policy path —
 * routing through the RPC turns that into a clear failure (`permission_denied`).
 */
export async function deleteGuestLink(linkId: string): Promise<boolean> {
  const trimmed = linkId?.trim() ?? '';
  if (!trimmed) {
    console.error('deleteGuestLink: empty linkId');
    return false;
  }
  return revokeGuestAccess(trimmed);
}

/**
 * Minimal model shape returned by the get_guest_link_models RPC.
 * Contains only the fields needed by GuestView — no sensitive internal data.
 * Private photos are never included. Image arrays are mutually exclusive:
 *   Portfolio package → portfolio_images populated, polaroids = []
 *   Polaroid package  → polaroids populated, portfolio_images = []
 *   Portfolio / polaroid URLs: prefer models.* mirror; if empty/stale, RPC fills from
 *   visible client rows in model_photos (parity with get_discovery_models — migrations
 *   20260532 polaroid, 20260714 portfolio).
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

// Edge-Function-based signed URL pipeline for guest packages and shared selections.
//
// Background (Security Audit 2026-04 / 2026-10):
//   The `documentspictures` bucket is private and intentionally has NO `anon SELECT`
//   policy on `storage.objects` (the table is owned by `supabase_storage_admin` and
//   cannot be modified via the Management API postgres role). Anonymous client-side
//   `createSignedUrl` calls therefore fail with HTTP 400/404 (`Object not found`).
//
//   The Edge Function `sign-guest-storage-asset` bridges that gap: it runs with the
//   SERVICE ROLE key (bypasses storage RLS), validates the request against the
//   appropriate context (active guest_link OR HMAC-validated shared_selection),
//   and returns short-lived signed URLs ONLY for paths that belong to allowed models.
//
//   TTL is 1 hour; GuestView and SharedSelectionView already refresh on demand
//   (focus/visibility) and via long-running intervals.
const SIGN_EDGE_FUNCTION = 'sign-guest-storage-asset';
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

type SignContext =
  | { context: 'guest_link'; linkId: string }
  | { context: 'shared_selection'; modelIds: string[]; token: string };

type SignEdgeResponse = {
  ok?: boolean;
  ttl?: number;
  signed?: Record<string, string>;
  error?: string;
};

/**
 * Calls the `sign-guest-storage-asset` Edge Function with a batch of bucket-relative
 * paths and returns a map `path → signedUrl` for paths the server allowed.
 *
 * Paths missing from the response map are either (a) outside the per-context
 * allowlist (silently skipped server-side, no leak) or (b) genuinely missing from
 * storage. Callers should treat absent entries as "render a placeholder".
 *
 * No throws on RPC error — returns an empty map and logs once per call.
 */
async function batchSignPathsViaEdgeFunction(
  ctx: SignContext,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const body: Record<string, unknown> = {
    context: ctx.context,
    paths,
  };
  if (ctx.context === 'guest_link') {
    body.linkId = ctx.linkId;
  } else {
    body.modelIds = ctx.modelIds;
    body.token = ctx.token;
  }

  try {
    const { data, error } = await supabase.functions.invoke<SignEdgeResponse>(SIGN_EDGE_FUNCTION, {
      body,
    });
    if (error) {
      console.error('[batchSignPathsViaEdgeFunction] invoke error', {
        context: ctx.context,
        pathCount: paths.length,
        error: (error as { message?: string })?.message ?? error,
      });
      return out;
    }
    if (!data?.ok || !data.signed) {
      console.error('[batchSignPathsViaEdgeFunction] response not ok', {
        context: ctx.context,
        pathCount: paths.length,
        responseError: data?.error,
      });
      return out;
    }
    for (const [path, signedUrl] of Object.entries(data.signed)) {
      if (typeof signedUrl === 'string' && signedUrl.length > 0) {
        out.set(path, signedUrl);
      }
    }
  } catch (e) {
    console.error('[batchSignPathsViaEdgeFunction] exception', {
      context: ctx.context,
      pathCount: paths.length,
      err: e,
    });
  }
  return out;
}

/**
 * Resolves an array of raw image references (canonical URI, legacy public URL,
 * relative path, bare filename) for a single model into signed URLs by:
 *   1. Normalising every reference (modelId-aware) to a canonical
 *      `supabase-storage://documentspictures/...` URI.
 *   2. Extracting the bucket-relative storage path.
 *   3. Looking up the corresponding signed URL in the supplied map (built
 *      previously with one batched Edge Function call).
 *
 * Already-signed external HTTPS URLs (data: / http(s)://) are passed through.
 * Entries that cannot be resolved are returned as `null` — callers must filter.
 */
export function applySignedUrls(
  urls: string[],
  modelId: string,
  signed: Map<string, string>,
): (string | null)[] {
  if (urls.length === 0) return urls;
  return urls.map((url) => {
    const normalized = normalizeDocumentspicturesModelImageRef(url, modelId);
    const path = extractStoragePath(normalized, DOCUMENTSPICTURES_BUCKET);
    if (path) {
      return signed.get(path) ?? null;
    }
    const passthrough = normalized.trim();
    if (passthrough.startsWith('https://') || passthrough.startsWith('http://')) {
      return passthrough;
    }
    return null;
  });
}

/**
 * Collects every bucket-relative `documentspictures/...` path referenced by a
 * list of model image arrays, after normalising the raw references with each
 * model's id. De-duplicates so the Edge Function gets a tight batch.
 */
export function collectStoragePathsForSigning(
  entries: Array<{ modelId: string; urls: string[] }>,
): string[] {
  const set = new Set<string>();
  for (const { modelId, urls } of entries) {
    for (const url of urls) {
      const normalized = normalizeDocumentspicturesModelImageRef(url, modelId);
      const path = extractStoragePath(normalized, DOCUMENTSPICTURES_BUCKET);
      if (path) set.add(path);
    }
  }
  return Array.from(set);
}

/**
 * Public batched entry point for the **guest_link** context. Signs every image
 * referenced by the given models in ONE Edge Function call.
 */
export async function signGuestLinkImages(
  linkId: string,
  models: Array<{ id: string; portfolio_images: string[]; polaroids?: string[] }>,
): Promise<Map<string, string>> {
  const entries = models.flatMap((m) => [
    { modelId: m.id, urls: m.portfolio_images ?? [] },
    { modelId: m.id, urls: m.polaroids ?? [] },
  ]);
  const paths = collectStoragePathsForSigning(entries);
  if (paths.length === 0) return new Map();
  return batchSignPathsViaEdgeFunction({ context: 'guest_link', linkId }, paths);
}

/**
 * Public batched entry point for the **shared_selection** context. Signs every
 * portfolio image for the given models in ONE Edge Function call.
 *
 * `modelIds` MUST be the same array that was used to compute the HMAC `token`
 * on the share-link generator side — the Edge Function recomputes the token
 * server-side via `shared_selection_compute_hmac` and rejects mismatches.
 */
export async function signSharedSelectionImages(
  modelIds: string[],
  token: string,
  models: Array<{ id: string; portfolio_images: string[] }>,
): Promise<Map<string, string>> {
  const entries = models.map((m) => ({ modelId: m.id, urls: m.portfolio_images ?? [] }));
  const paths = collectStoragePathsForSigning(entries);
  if (paths.length === 0) return new Map();
  return batchSignPathsViaEdgeFunction({ context: 'shared_selection', modelIds, token }, paths);
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
export async function getGuestLinkModels(linkId: string): Promise<ServiceResult<GuestLinkModel[]>> {
  const trimmed = linkId?.trim() ?? '';
  if (!trimmed) {
    return serviceErr(uiCopy.b2bChat.packageModelsLoadFailed);
  }
  const idPrefix = trimmed.length >= 8 ? `${trimmed.slice(0, 8)}…` : trimmed;

  let hasSession = false;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
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
  const hasNonEmptyAnonKey = typeof sc.supabaseKey === 'string' && sc.supabaseKey.trim().length > 0;
  const looksLikePlaceholderSupabaseUrl = (sc.supabaseUrl ?? '').includes(
    'placeholder.supabase.co',
  );

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

    // Rewrite image arrays to signed URLs via Edge Function (Security Audit
    // 2026-10): the documentspictures bucket has no anon SELECT policy so
    // client-side createSignedUrl() fails with HTTP 400/404 for guest viewers.
    // The Edge Function bypasses storage RLS using the service role key and
    // validates that every requested path belongs to a model in this guest link.
    const signedMap = await signGuestLinkImages(trimmed, models);
    const signed = models.map((m) => ({
      ...m,
      portfolio_images: applySignedUrls(m.portfolio_images, m.id, signedMap).filter(
        (u): u is string => u !== null,
      ),
      polaroids: applySignedUrls(m.polaroids, m.id, signedMap).filter(
        (u): u is string => u !== null,
      ),
    }));
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
