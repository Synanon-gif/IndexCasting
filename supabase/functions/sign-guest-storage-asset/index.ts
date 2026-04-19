/**
 * sign-guest-storage-asset — Server-side signed URL generation for guest packages
 * and shared selection links (anon callers).
 *
 * BACKGROUND
 * The `documentspictures` storage bucket is private and intentionally has NO
 * `anon SELECT` policy on `storage.objects` (the table is owned by
 * `supabase_storage_admin` and cannot be modified via the Management API
 * Postgres role). Anonymous client-side `createSignedUrl` calls therefore fail
 * with HTTP 400/404 (`Object not found`).
 *
 * This Edge Function bridges that gap: it runs with the SERVICE ROLE key (which
 * bypasses storage RLS), validates the request against the appropriate
 * SECURITY DEFINER context (guest_link OR shared_selection HMAC), and returns
 * short-lived signed URLs for ONLY the paths that belong to allowed models.
 *
 * SECURITY MODEL
 *   1. Bucket whitelist: only `documentspictures` may be signed.
 *   2. Per-context model_id allowlist:
 *        guest_link        → `guest_links.model_ids` (active, non-expired link)
 *        shared_selection  → recomputed HMAC must match supplied `token`
 *   3. Per-model PATH allowlist (canonical): for each allowed model_id we load
 *      every storage reference that the model legitimately owns:
 *        a. `models.portfolio_images[]` (mirror)
 *        b. `models.polaroids[]`        (mirror)
 *        c. `model_photos.url` rows    (authoritative, only client-visible ones)
 *      Each reference is normalised to its bucket-relative path; the union
 *      forms the request's path-allowlist.
 *   4. Paths in the request that are NOT in the per-model path allowlist are
 *      silently skipped (no signed URL returned, no error → no leak about which
 *      paths exist).
 *   5. Short TTL (1 hour). Clients refresh on demand and via existing intervals.
 *   6. CORS restricted to known production origins (and localhost for dev).
 *
 * Why a DB-derived allowlist (not just path-shape):
 *   Some legacy paths (e.g. application uploads) live under
 *   `model-applications/<file>` WITHOUT a model UUID segment. The previous
 *   shape-only filter (`<prefix>/<uuid>/<file>`) silently rejected those paths,
 *   producing visible-image regressions for guest viewers. The DB-derived
 *   allowlist binds every path to its owning model_id via the live mirror /
 *   model_photos rows, so legacy paths sign correctly while still being
 *   strictly scoped to the allowed model set.
 *
 * NEVER signs paths the client provides without DB-validated allowlist.
 * NEVER returns the service role key or any secret. NEVER mutates state.
 *
 * Request:
 *   POST /sign-guest-storage-asset
 *   Body: {
 *     "context": "guest_link" | "shared_selection",
 *     "linkId":  "<uuid>"          // required for guest_link
 *     "modelIds": ["<uuid>", ...]  // required for shared_selection
 *     "token":    "<hmac>"         // required for shared_selection
 *     "paths":   ["model-photos/<uuid>/file.jpg", ...]
 *   }
 *
 * Response (200):
 *   {
 *     "ok": true,
 *     "ttl": 3600,
 *     "signed": {
 *       "<originalPath1>": "https://...signed-url-1",
 *       "<originalPath2>": "https://...signed-url-2"
 *     }
 *   }
 *
 * Response (4xx):
 *   { "ok": false, "error": "<reason>" }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_BUCKET = 'documentspictures';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const MAX_PATHS_PER_REQUEST = 200;
const MAX_MODELS_PER_REQUEST = 50;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Exact-match production / canonical origins.
const ALLOWED_EXACT_ORIGINS = new Set<string>([
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
  'https://www.indexcasting.com',
]);

// Pattern-based allowlist — host-only matching (case-insensitive). Each entry
// MUST evaluate the parsed URL hostname; never substring-match the raw Origin
// string (would allow `evil-indexcasting.com.attacker.example`).
const ALLOWED_HOST_PATTERNS: Array<(host: string) => boolean> = [
  // Any subdomain of our two canonical apex domains.
  (h) => h === 'indexcasting.com' || h.endsWith('.indexcasting.com'),
  (h) => h === 'index-casting.com' || h.endsWith('.index-casting.com'),
  // Vercel preview deployments for this project.
  (h) => h.endsWith('.vercel.app'),
  // Local development on any port (web bundlers + Expo web).
  (h) => h === 'localhost' || h === '127.0.0.1',
];

const FALLBACK_ORIGIN = 'https://index-casting.com';

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_EXACT_ORIGINS.has(origin)) return true;
  let host = '';
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return ALLOWED_HOST_PATTERNS.some((pred) => pred(host));
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  // Native callers (iOS/Android, server-to-server) typically send no Origin
  // and don't enforce CORS — reflecting the canonical origin is harmless and
  // keeps a deterministic header value in logs.
  const allowOrigin = isOriginAllowed(origin) ? origin : FALLBACK_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Path normalisation (mirrors src/utils/normalizeModelPortfolioUrl.ts +
//     src/storage/storageUrl.ts → extractBucketAndPath). Keep these in sync. ──

const MODEL_PHOTOS_PREFIX = 'model-photos';
const MODEL_APPLICATIONS_PREFIX = 'model-applications';
const LEGACY_BARE_IMAGE_FILE = /^[^/\\:?*]+\.(jpe?g|png|webp|gif|heic|heif)$/i;
const RELATIVE_WITH_SUBDIR = /^[a-f0-9-]+\/[^/\\:?*]+\.(jpe?g|png|webp|gif|heic|heif)$/i;

function normalizeRefToStorageUri(raw: string, modelId: string): string {
  const s = (raw ?? '').trim();
  if (!s) return s;
  const mid = (modelId ?? '').trim();
  if (!mid) return s;

  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('supabase-storage://') ||
    s.startsWith('supabase-private://')
  ) {
    return s;
  }
  if (s.startsWith(`${MODEL_PHOTOS_PREFIX}/`)) {
    return `supabase-storage://${ALLOWED_BUCKET}/${s}`;
  }
  if (s.startsWith(`${MODEL_APPLICATIONS_PREFIX}/`)) {
    return `supabase-storage://${ALLOWED_BUCKET}/${s}`;
  }
  if (!s.includes('://') && RELATIVE_WITH_SUBDIR.test(s)) {
    return `supabase-storage://${ALLOWED_BUCKET}/${MODEL_PHOTOS_PREFIX}/${s}`;
  }
  if (!s.includes('://') && !s.includes('/') && LEGACY_BARE_IMAGE_FILE.test(s)) {
    return `supabase-storage://${ALLOWED_BUCKET}/${MODEL_PHOTOS_PREFIX}/${mid}/${s}`;
  }
  return s;
}

function extractBucketAndPath(url: string): { bucket: string; path: string } | null {
  if (!url) return null;
  if (url.startsWith('supabase-storage://')) {
    const rest = url.slice('supabase-storage://'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return null;
    return { bucket: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  if (url.startsWith('supabase-private://')) {
    const rest = url.slice('supabase-private://'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return null;
    return { bucket: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (match?.[1] && match?.[2]) {
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  }
  return null;
}

/**
 * Normalises a raw image reference (mirror column entry, model_photos.path,
 * legacy public URL, bare filename, etc.) to its bucket-relative path within
 * `documentspictures`. Returns null when the reference is external or cannot
 * be mapped onto the allowed bucket.
 */
function refToBucketPath(raw: string, modelId: string): string | null {
  const normalized = normalizeRefToStorageUri(raw, modelId);
  const extracted = extractBucketAndPath(normalized);
  if (!extracted) return null;
  if (extracted.bucket !== ALLOWED_BUCKET) return null;
  return extracted.path || null;
}

// ─── Context resolution ──────────────────────────────────────────────────────

type GuestLinkRow = {
  id: string;
  model_ids: string[];
  is_active: boolean;
  deleted_at: string | null;
  expires_at: string | null;
  first_accessed_at: string | null;
};

async function resolveAllowedModelIdsForGuestLink(
  admin: ReturnType<typeof createClient>,
  linkId: string,
): Promise<{ ok: true; modelIds: Set<string> } | { ok: false; error: string; status: number }> {
  if (!UUID_REGEX.test(linkId)) {
    return { ok: false, error: 'invalid_link_id', status: 400 };
  }
  const { data, error } = await admin
    .from('guest_links')
    .select('id, model_ids, is_active, deleted_at, expires_at, first_accessed_at')
    .eq('id', linkId)
    .maybeSingle<GuestLinkRow>();

  if (error) {
    console.error('[sign-guest-storage-asset] guest_links lookup error', error);
    return { ok: false, error: 'guest_link_lookup_failed', status: 500 };
  }
  if (!data) {
    return { ok: false, error: 'guest_link_not_found', status: 404 };
  }
  if (!data.is_active || data.deleted_at !== null) {
    return { ok: false, error: 'guest_link_inactive', status: 403 };
  }

  const now = Date.now();
  if (data.first_accessed_at) {
    const firstOpened = new Date(data.first_accessed_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (firstOpened + sevenDaysMs <= now) {
      return { ok: false, error: 'guest_link_expired', status: 403 };
    }
  } else if (data.expires_at) {
    if (new Date(data.expires_at).getTime() <= now) {
      return { ok: false, error: 'guest_link_expired', status: 403 };
    }
  }

  const set = new Set<string>();
  for (const id of data.model_ids ?? []) {
    if (typeof id === 'string' && UUID_REGEX.test(id)) {
      set.add(id.toLowerCase());
    }
  }
  return { ok: true, modelIds: set };
}

async function resolveAllowedModelIdsForSharedSelection(
  admin: ReturnType<typeof createClient>,
  modelIds: string[],
  token: string,
): Promise<{ ok: true; modelIds: Set<string> } | { ok: false; error: string; status: number }> {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    return { ok: false, error: 'missing_model_ids', status: 400 };
  }
  if (modelIds.length > MAX_MODELS_PER_REQUEST) {
    return { ok: false, error: 'too_many_model_ids', status: 400 };
  }
  const cleaned = modelIds
    .filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id))
    .map((id) => id.toLowerCase());
  if (cleaned.length === 0) {
    return { ok: false, error: 'invalid_model_ids', status: 400 };
  }
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, error: 'missing_token', status: 400 };
  }

  // Validate token by recomputing HMAC server-side via the SECURITY DEFINER RPC.
  const { data, error } = await admin.rpc('shared_selection_compute_hmac', {
    p_model_ids: modelIds,
  });
  if (error) {
    console.error('[sign-guest-storage-asset] shared_selection_compute_hmac error', error);
    return { ok: false, error: 'token_validation_failed', status: 500 };
  }
  const expected = (data ?? '') as string;
  if (expected !== token) {
    return { ok: false, error: 'token_invalid', status: 403 };
  }

  return { ok: true, modelIds: new Set(cleaned) };
}

// ─── DB-derived per-model path allowlist ─────────────────────────────────────

type ModelMirrorRow = {
  id: string;
  portfolio_images: string[] | null;
  polaroids: string[] | null;
};

type ModelPhotoRow = {
  model_id: string;
  url: string | null;
  is_visible_to_clients: boolean | null;
};

/**
 * For every allowed model_id, builds the union of storage paths that the model
 * legitimately owns: mirror columns (`models.portfolio_images`, `models.polaroids`)
 * + visible `model_photos` rows. Returns a flat `Set<bucketPath>` against which
 * caller-supplied paths are filtered.
 *
 * Defense-in-Depth: even if the mirror columns are stale or include drifted
 * legacy paths, only paths that genuinely resolve under `documentspictures` for
 * one of the allowed models will be signed.
 */
async function buildPathAllowlist(
  admin: ReturnType<typeof createClient>,
  allowedModelIds: Set<string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (allowedModelIds.size === 0) return out;
  const ids = Array.from(allowedModelIds);

  // 1. Mirror columns on `models`.
  const { data: modelRows, error: modelErr } = await admin
    .from('models')
    .select('id, portfolio_images, polaroids')
    .in('id', ids)
    .returns<ModelMirrorRow[]>();
  if (modelErr) {
    console.error('[sign-guest-storage-asset] models lookup error', modelErr);
  } else if (modelRows) {
    for (const row of modelRows) {
      const mid = (row.id ?? '').toLowerCase();
      if (!UUID_REGEX.test(mid)) continue;
      for (const ref of row.portfolio_images ?? []) {
        const path = refToBucketPath(typeof ref === 'string' ? ref : '', mid);
        if (path) out.add(path);
      }
      for (const ref of row.polaroids ?? []) {
        const path = refToBucketPath(typeof ref === 'string' ? ref : '', mid);
        if (path) out.add(path);
      }
    }
  }

  // 2. Authoritative `model_photos` rows (client-visible only).
  //    This handles the case where the mirror columns are stale but model_photos
  //    has the up-to-date set; aligns with the same authority used by
  //    can_view_model_photo_storage / get_*_models RPCs.
  const { data: photoRows, error: photoErr } = await admin
    .from('model_photos')
    .select('model_id, url, is_visible_to_clients')
    .in('model_id', ids)
    .eq('is_visible_to_clients', true)
    .returns<ModelPhotoRow[]>();
  if (photoErr) {
    // Non-fatal — mirror coverage may already be sufficient. Log and continue.
    console.error('[sign-guest-storage-asset] model_photos lookup error', photoErr);
  } else if (photoRows) {
    for (const row of photoRows) {
      const mid = (row.model_id ?? '').toLowerCase();
      if (!UUID_REGEX.test(mid)) continue;
      const path = refToBucketPath(typeof row.url === 'string' ? row.url : '', mid);
      if (path) out.add(path);
    }
  }

  return out;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(withObservability('sign-guest-storage-asset', async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json_body' }, 400, corsHeaders);
  }

  const context = (body.context as string | undefined)?.trim();
  const rawPaths = body.paths;
  if (context !== 'guest_link' && context !== 'shared_selection') {
    return jsonResponse({ ok: false, error: 'invalid_context' }, 400, corsHeaders);
  }
  if (!Array.isArray(rawPaths)) {
    return jsonResponse({ ok: false, error: 'paths_must_be_array' }, 400, corsHeaders);
  }
  if (rawPaths.length === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }
  if (rawPaths.length > MAX_PATHS_PER_REQUEST) {
    return jsonResponse({ ok: false, error: 'too_many_paths' }, 400, corsHeaders);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve allowed model_id set for the requested context.
  let allowedModels: Set<string>;
  if (context === 'guest_link') {
    const linkId = (body.linkId as string | undefined)?.trim() ?? '';
    if (!linkId) {
      return jsonResponse({ ok: false, error: 'missing_link_id' }, 400, corsHeaders);
    }
    const res = await resolveAllowedModelIdsForGuestLink(admin, linkId);
    if (!res.ok) {
      return jsonResponse({ ok: false, error: res.error }, res.status, corsHeaders);
    }
    allowedModels = res.modelIds;
  } else {
    const modelIds = body.modelIds as unknown;
    const token = body.token as unknown;
    if (!Array.isArray(modelIds)) {
      return jsonResponse({ ok: false, error: 'modelIds_must_be_array' }, 400, corsHeaders);
    }
    const res = await resolveAllowedModelIdsForSharedSelection(
      admin,
      modelIds as string[],
      typeof token === 'string' ? token : '',
    );
    if (!res.ok) {
      return jsonResponse({ ok: false, error: res.error }, res.status, corsHeaders);
    }
    allowedModels = res.modelIds;
  }

  if (allowedModels.size === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }

  // 2. Build per-model PATH allowlist from the live DB (mirror + model_photos).
  const allowedPaths = await buildPathAllowlist(admin, allowedModels);
  if (allowedPaths.size === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }

  // 3. Filter requested paths against the allowlist. Preserve original strings
  //    as response keys so the client can map signed URL → original entry.
  const validPaths: string[] = [];
  for (const raw of rawPaths) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!allowedPaths.has(trimmed)) continue;
    validPaths.push(trimmed);
  }

  if (validPaths.length === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }

  // 4. Sign all valid paths in a single batch call.
  const { data: signedList, error: signError } = await admin.storage
    .from(ALLOWED_BUCKET)
    .createSignedUrls(validPaths, SIGNED_URL_TTL_SECONDS);

  if (signError) {
    console.error('[sign-guest-storage-asset] createSignedUrls error', signError);
    return jsonResponse({ ok: false, error: 'sign_failed' }, 500, corsHeaders);
  }

  const signed: Record<string, string> = {};
  for (const entry of signedList ?? []) {
    if (entry.error) {
      // Silently skip — path is in the allowlist but the object does not exist
      // in storage (e.g. mirror drift). Caller renders a placeholder.
      continue;
    }
    if (entry.path && entry.signedUrl) {
      signed[entry.path] = entry.signedUrl;
    }
  }

  return jsonResponse(
    { ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed },
    200,
    corsHeaders,
  );
}));
