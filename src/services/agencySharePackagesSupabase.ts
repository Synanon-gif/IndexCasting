/**
 * Agency-to-Agency Roster Share — service layer.
 *
 * High-level flow:
 *   Sender Agency:
 *     createAgencyShareePackage() → calls RPC `create_agency_share_package`,
 *     receives `link_id` + resolved `target_agency_id`. Then
 *     sendAgencyShareInviteEmail() invokes the Edge Function
 *     `send-agency-share-invite` to notify the recipient by email.
 *
 *   Recipient Agency:
 *     getAgencyShareInbox() → list incoming agency_share guest_links.
 *     getAgencyShareModels() → load the roster of a specific share.
 *     importModelsFromAgencyShare() → write per-model country picks into
 *       `model_agency_territories` (skips conflicts; reports them).
 *     generateModelClaimToken() (existing service in modelsSupabase.ts)
 *       can be called by recipient agencies for unclaimed models thanks to
 *       the co-agency branch added in migration 20261023.
 *
 * Contract (Hybrid):
 *   - Inbox / list reads return Option A (`[]` on failure) to mirror the
 *     existing `getGuestLinksForAgency()` pattern.
 *   - Mutating RPCs return `ServiceResult<...>` so callers can branch on
 *     specific error codes (RLS denied vs. invalid recipient vs. self-share).
 *
 * Multi-Tenant safety:
 *   Every entry point that takes an `organizationId` is guarded with
 *   `assertOrgContext()`. The DB RPCs additionally enforce sender / recipient
 *   org membership so a missing or wrong org context becomes a typed error
 *   rather than a silent leak.
 */

import { supabase } from '../../lib/supabase';
import { serviceErr, serviceOkData, type ServiceResult } from '../types/serviceResult';
import { assertOrgContext } from '../utils/orgGuard';
import { extractBucketAndPath } from '../storage/storageUrl';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';

const SIGN_EDGE_FUNCTION = 'sign-guest-storage-asset';
const DOCUMENTSPICTURES_BUCKET = 'documentspictures';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of `create_agency_share_package` — the new guest_links row id plus
 * the resolved recipient agency. The frontend should use these values to
 * (a) build the magic-link URL via {@link buildAgencyShareUrl} and
 * (b) call {@link sendAgencyShareInviteEmail} with the recipient context.
 */
export type AgencyShareCreateResult = {
  linkId: string;
  targetAgencyId: string;
  targetAgencyName: string;
};

/**
 * Inbox entry as returned by `get_agency_share_inbox`.
 * Display-safe summary (no full model_ids or measurements).
 */
export type AgencyShareInboxEntry = {
  linkId: string;
  senderAgencyId: string;
  senderAgencyName: string;
  modelCount: number;
  label: string | null;
  /** 'portfolio' | 'polaroid' | 'mixed' — what the share contains. */
  type: 'portfolio' | 'polaroid' | 'mixed';
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  firstAccessedAt: string | null;
};

/**
 * Detailed model row for a recipient agency viewing an incoming share.
 * Same shape as `GuestLinkModel` but with sender-side account info so
 * the recipient UI can decide whether to offer "Generate claim token"
 * (model has no account) or "Already linked" (account exists).
 */
export type AgencyShareModel = {
  id: string;
  name: string;
  height: number | null;
  /** Legacy DB column — UI must render as "Chest" / `chest ?? bust`. */
  bust: number | null;
  waist: number | null;
  hips: number | null;
  city: string | null;
  hairColor: string | null;
  eyeColor: string | null;
  sex: string | null;
  portfolioImages: string[];
  polaroids: string[];
  /** Canonical city from model_locations (live > current > agency). */
  effectiveCity: string | null;
  /** auth.users.id when the model has claimed an account; otherwise null. */
  userId: string | null;
  hasAccount: boolean;
};

/**
 * Per-model territory request used by {@link importModelsFromAgencyShare}.
 * `countryCodes` MUST be ISO-3166-1 alpha-2 uppercase (e.g. 'DE', 'GB').
 */
export type AgencyShareImportRequest = {
  modelId: string;
  countryCodes: string[];
};

/**
 * Result of `import_models_from_agency_share`. `imported` reflects new
 * `model_agency_territories` rows; `skipped` rows already had another agency
 * pinned for that (model_id, country_code) pair — `existingAgencyId` lets
 * the UI explain "Model X is already represented by Agency Y in Country Z".
 */
export type AgencyShareImportResult = {
  imported: Array<{ modelId: string; countryCode: string }>;
  skipped: Array<{ modelId: string; countryCode: string; existingAgencyId: string | null }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sender side — create + email
// ─────────────────────────────────────────────────────────────────────────────

export type CreateAgencyShareParams = {
  organizationId: string;
  recipientEmail: string;
  modelIds: string[];
  label?: string | null;
  /** ISO timestamp; null/undefined leaves the link non-expiring (UI default may shorten). */
  expiresAt?: string | null;
};

/**
 * Creates a new agency-to-agency share package. Sender membership is enforced
 * server-side (caller MUST be a member of `organizationId` and that org MUST
 * be of type 'agency'). Models that do not belong to the sender's home agency
 * are rejected with `invalid_models_for_sender` (current v1 scope).
 *
 * On success returns `{ linkId, targetAgencyId, targetAgencyName }`.
 *
 * Common error codes from the RPC:
 *   - `recipient_agency_not_found`  → recipient has no IndexCasting account
 *   - `cannot_share_with_self`      → resolved recipient is the sender agency
 *   - `not_member_of_sender_organization`
 *   - `invalid_models_for_sender`   → at least one model is not the sender's
 */
export async function createAgencyShareePackage(
  params: CreateAgencyShareParams,
): Promise<ServiceResult<AgencyShareCreateResult>> {
  if (!assertOrgContext(params.organizationId, 'createAgencyShareePackage')) {
    return serviceErr('missing_organization_context');
  }
  const recipient = params.recipientEmail.trim().toLowerCase();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return serviceErr('invalid_recipient_email');
  }
  const modelIds = (params.modelIds ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (modelIds.length === 0) {
    return serviceErr('no_models_selected');
  }

  try {
    const { data, error } = await supabase.rpc('create_agency_share_package', {
      p_organization_id: params.organizationId,
      p_recipient_email: recipient,
      p_model_ids: modelIds,
      p_label: params.label?.trim() || null,
      p_expires_at: params.expiresAt ?? null,
    });
    if (error) {
      console.error('[createAgencyShareePackage] rpc error', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return serviceErr(error.message ?? 'rpc_error');
    }
    // RPC RETURNS TABLE — PostgREST may serialise as array or single object.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return serviceErr('no_result');
    }
    const r = row as { link_id?: string; target_agency_id?: string; target_agency_name?: string };
    if (!r.link_id || !r.target_agency_id) {
      return serviceErr('malformed_rpc_response');
    }
    return serviceOkData({
      linkId: r.link_id,
      targetAgencyId: r.target_agency_id,
      targetAgencyName: r.target_agency_name ?? '',
    });
  } catch (e) {
    console.error('[createAgencyShareePackage] exception', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

export type SendAgencyShareInviteParams = {
  linkId: string;
  to: string;
  senderOrganizationId: string;
  senderAgencyName?: string;
  recipientAgencyName?: string;
  inviterName?: string;
  modelCount?: number;
  label?: string | null;
};

/**
 * Invokes the `send-agency-share-invite` Edge Function which sends an HTML
 * email via Resend with a deep-link to `?agency_share=<link_id>`.
 *
 * The Edge Function re-validates the caller's membership in the sender org
 * and that the link belongs to that agency, so a stolen link_id alone cannot
 * trigger spam.
 */
export async function sendAgencyShareInviteEmail(
  params: SendAgencyShareInviteParams,
): Promise<ServiceResult<{ emailId: string | null }>> {
  if (!assertOrgContext(params.senderOrganizationId, 'sendAgencyShareInviteEmail')) {
    return serviceErr('missing_organization_context');
  }
  const linkId = params.linkId?.trim();
  const to = params.to?.trim().toLowerCase();
  if (!linkId) return serviceErr('missing_link_id');
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return serviceErr('invalid_email');

  try {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      email_id?: string;
      error?: string;
    }>('send-agency-share-invite', {
      body: {
        link_id: linkId,
        to,
        sender_organization_id: params.senderOrganizationId,
        sender_agency_name: params.senderAgencyName,
        recipient_agency_name: params.recipientAgencyName,
        inviter_name: params.inviterName,
        model_count: params.modelCount,
        label: params.label,
      },
    });
    if (error) {
      console.error('[sendAgencyShareInviteEmail] invoke error', error);
      return serviceErr((error as { message?: string }).message ?? 'edge_function_error');
    }
    if (!data?.ok) {
      return serviceErr(data?.error ?? 'email_send_failed');
    }
    return serviceOkData({ emailId: data.email_id ?? null });
  } catch (e) {
    console.error('[sendAgencyShareInviteEmail] exception', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient side — inbox + detail + import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists incoming agency_share packages for the recipient agency identified by
 * `organizationId`. RPC enforces caller membership in that agency org.
 *
 * Option A return: `[]` on any failure. Errors are logged structured.
 */
export async function getAgencyShareInbox(
  organizationId: string,
): Promise<AgencyShareInboxEntry[]> {
  if (!assertOrgContext(organizationId, 'getAgencyShareInbox')) return [];
  try {
    const { data, error } = await supabase.rpc('get_agency_share_inbox', {
      p_organization_id: organizationId,
    });
    if (error) {
      console.error('[getAgencyShareInbox] rpc error', {
        code: error.code,
        message: error.message,
      });
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.map((r): AgencyShareInboxEntry => {
      const row = r as Record<string, unknown>;
      return {
        linkId: String(row.link_id ?? ''),
        senderAgencyId: String(row.sender_agency_id ?? ''),
        senderAgencyName: String(row.sender_agency_name ?? ''),
        modelCount: typeof row.model_count === 'number' ? row.model_count : 0,
        label: (row.label as string | null) ?? null,
        type:
          (row.type as string) === 'polaroid' || (row.type as string) === 'mixed'
            ? (row.type as 'polaroid' | 'mixed')
            : 'portfolio',
        expiresAt: (row.expires_at as string | null) ?? null,
        isActive: row.is_active === true,
        createdAt: String(row.created_at ?? ''),
        firstAccessedAt: (row.first_accessed_at as string | null) ?? null,
      };
    });
  } catch (e) {
    console.error('[getAgencyShareInbox] exception', e);
    return [];
  }
}

/**
 * Loads the model roster for a specific agency_share link as seen by the
 * recipient agency. RPC enforces (a) link.purpose = 'agency_share',
 * (b) caller is a member of `target_agency_id`, (c) link not soft-deleted.
 *
 * Image URLs are routed through the same Edge-Function-based signing pipeline
 * as the client-facing guest packages so private storage rows remain protected.
 */
export async function getAgencyShareModels(
  linkId: string,
): Promise<ServiceResult<AgencyShareModel[]>> {
  const trimmed = linkId?.trim() ?? '';
  if (!trimmed) return serviceErr('missing_link_id');

  try {
    const { data, error } = await supabase.rpc('get_agency_share_models', {
      p_link_id: trimmed,
    });
    if (error) {
      console.error('[getAgencyShareModels] rpc error', {
        code: error.code,
        message: error.message,
      });
      return serviceErr(error.message ?? 'rpc_error');
    }
    const rows = Array.isArray(data) ? data : [];
    const raw = rows.map((r): AgencyShareModel => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        height: typeof row.height === 'number' ? row.height : null,
        bust: typeof row.bust === 'number' ? row.bust : null,
        waist: typeof row.waist === 'number' ? row.waist : null,
        hips: typeof row.hips === 'number' ? row.hips : null,
        city: (row.city as string | null) ?? null,
        hairColor: (row.hair_color as string | null) ?? null,
        eyeColor: (row.eye_color as string | null) ?? null,
        sex: (row.sex as string | null) ?? null,
        portfolioImages: Array.isArray(row.portfolio_images)
          ? (row.portfolio_images as unknown[]).map((u) => String(u))
          : [],
        polaroids: Array.isArray(row.polaroids)
          ? (row.polaroids as unknown[]).map((u) => String(u))
          : [],
        effectiveCity: (row.effective_city as string | null) ?? null,
        userId: (row.user_id as string | null) ?? null,
        hasAccount: row.has_account === true,
      };
    });

    // Sign image references via the existing guest-link Edge Function. The
    // `agency_share` link_id passes the same allowlist check the function
    // applies for `client_share` (active, non-deleted, paths within model_ids
    // of THIS link), so we can reuse it as-is.
    const signed = await signAgencyShareImages(trimmed, raw);
    const withSigned = raw.map((m) => ({
      ...m,
      portfolioImages: applySignedUrls(m.portfolioImages, m.id, signed).filter(
        (u): u is string => u !== null,
      ),
      polaroids: applySignedUrls(m.polaroids, m.id, signed).filter((u): u is string => u !== null),
    }));
    return serviceOkData(withSigned);
  } catch (e) {
    console.error('[getAgencyShareModels] exception', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

/**
 * Imports the recipient agency as a co-agency for the supplied
 * (model_id, country_code) tuples. Existing `model_agency_territories`
 * rows are NEVER overwritten — conflicts are returned in `skipped` so the
 * recipient sees which combinations are already taken (and by whom).
 */
export async function importModelsFromAgencyShare(params: {
  organizationId: string;
  linkId: string;
  imports: AgencyShareImportRequest[];
}): Promise<ServiceResult<AgencyShareImportResult>> {
  if (!assertOrgContext(params.organizationId, 'importModelsFromAgencyShare')) {
    return serviceErr('missing_organization_context');
  }
  const linkId = params.linkId?.trim();
  if (!linkId) return serviceErr('missing_link_id');
  const cleaned = (params.imports ?? [])
    .map((r) => ({
      modelId: r.modelId?.trim() ?? '',
      countryCodes: (r.countryCodes ?? [])
        .map((c) => c?.trim().toUpperCase())
        .filter((c): c is string => !!c && /^[A-Z]{2}$/.test(c)),
    }))
    .filter((r) => r.modelId && r.countryCodes.length > 0);
  if (cleaned.length === 0) return serviceErr('no_imports');

  try {
    const { data, error } = await supabase.rpc('import_models_from_agency_share', {
      p_organization_id: params.organizationId,
      p_link_id: linkId,
      // RPC expects jsonb with snake_case keys
      p_imports: cleaned.map((r) => ({
        model_id: r.modelId,
        country_codes: r.countryCodes,
      })),
    });
    if (error) {
      console.error('[importModelsFromAgencyShare] rpc error', {
        code: error.code,
        message: error.message,
      });
      return serviceErr(error.message ?? 'rpc_error');
    }
    const obj = (data ?? {}) as { imported?: unknown[]; skipped?: unknown[] };
    const imported = Array.isArray(obj.imported)
      ? obj.imported.map((x) => {
          const o = x as Record<string, unknown>;
          return {
            modelId: String(o.model_id ?? ''),
            countryCode: String(o.country_code ?? ''),
          };
        })
      : [];
    const skipped = Array.isArray(obj.skipped)
      ? obj.skipped.map((x) => {
          const o = x as Record<string, unknown>;
          return {
            modelId: String(o.model_id ?? ''),
            countryCode: String(o.country_code ?? ''),
            existingAgencyId: (o.existing_agency_id as string | null) ?? null,
          };
        })
      : [];
    return serviceOkData({ imported, skipped });
  } catch (e) {
    console.error('[importModelsFromAgencyShare] exception', e);
    return serviceErr(e instanceof Error ? e.message : 'exception');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the agency-share magic-link URL. The `?agency_share=` query parameter
 * is intentionally distinct from `?guest=` (client-facing package) and
 * `?shared=` (client project share) so the App.tsx router can dispatch them
 * to different surfaces and apply different login gating.
 */
export function buildAgencyShareUrl(linkId: string): string {
  const safe = linkId.trim();
  if (typeof window !== 'undefined' && window.location?.origin) {
    const u = new URL(window.location.origin + (window.location.pathname || '/'));
    u.searchParams.set('agency_share', safe);
    return u.toString();
  }
  return `https://index-casting.com/?agency_share=${encodeURIComponent(safe)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage path signing — reuse Edge Function `sign-guest-storage-asset`
// ─────────────────────────────────────────────────────────────────────────────

function extractStoragePath(url: string, bucket: string): string | null {
  const extracted = extractBucketAndPath(url);
  if (!extracted || extracted.bucket !== bucket) return null;
  return extracted.path || null;
}

function collectAgencySharePaths(models: AgencyShareModel[]): string[] {
  const set = new Set<string>();
  for (const m of models) {
    for (const url of [...(m.portfolioImages ?? []), ...(m.polaroids ?? [])]) {
      const normalized = normalizeDocumentspicturesModelImageRef(url, m.id);
      const path = extractStoragePath(normalized, DOCUMENTSPICTURES_BUCKET);
      if (path) set.add(path);
    }
  }
  return Array.from(set);
}

async function signAgencyShareImages(
  linkId: string,
  models: AgencyShareModel[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths = collectAgencySharePaths(models);
  if (paths.length === 0) return out;
  try {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      signed?: Record<string, string>;
      error?: string;
    }>(SIGN_EDGE_FUNCTION, {
      body: { context: 'guest_link', linkId, paths },
    });
    if (error) {
      console.error('[signAgencyShareImages] invoke error', {
        linkIdPrefix: linkId.slice(0, 8),
        pathCount: paths.length,
        message: (error as { message?: string }).message,
      });
      return out;
    }
    if (!data?.ok || !data.signed) {
      console.error('[signAgencyShareImages] response not ok', {
        linkIdPrefix: linkId.slice(0, 8),
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
    console.error('[signAgencyShareImages] exception', e);
  }
  return out;
}

function applySignedUrls(
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
