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
 *   2. Path shape whitelist: `(model-photos|model-applications)/<uuid>/<file>`
 *   3. Per-context allowlist:
 *        guest_link        → `guest_links.model_ids` (active, non-expired link)
 *        shared_selection  → recomputed HMAC must match supplied `token`
 *   4. Paths whose extracted model_id is NOT in the allowlist are silently
 *      skipped (no signed URL returned for them — no error to avoid leaking
 *      which paths are valid).
 *   5. Short TTL (1 hour). Clients refresh on demand and via existing intervals.
 *   6. CORS restricted to known production origins (and localhost for dev).
 *
 * NEVER signs paths the client provides without context-based validation. NEVER
 * returns the service role key or any secret. NEVER mutates state.
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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_BUCKET = 'documentspictures';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const MAX_PATHS_PER_REQUEST = 200;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_PATH_PREFIXES = ['model-photos/', 'model-applications/'];

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
  'https://www.indexcasting.com',
  'http://localhost:8081',
  'http://localhost:19006',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

/**
 * Extracts the model UUID segment from a bucket-relative path.
 * Returns null if the path does not match the expected shape.
 *   model-photos/<uuid>/<file>          → uuid
 *   model-applications/<uuid>/<file>    → uuid
 */
function extractModelIdFromPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (!ALLOWED_PATH_PREFIXES.some((p) => trimmed.startsWith(p))) return null;
  const parts = trimmed.split('/');
  if (parts.length < 3) return null;
  const candidate = parts[1];
  if (!UUID_REGEX.test(candidate)) return null;
  return candidate.toLowerCase();
}

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
  // Mirror the access-window logic of get_guest_link_models():
  //   - never opened: respect expires_at
  //   - opened: 7 days from first_accessed_at
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
  if (modelIds.length > 50) {
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
  // The RPC orders & joins the IDs identically to how the share link generates
  // the token, so we pass the original (un-sorted) array to the RPC.
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

Deno.serve(async (req: Request) => {
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

  // 1. Resolve the allowed model_id set for the requested context.
  let allowed: Set<string>;
  if (context === 'guest_link') {
    const linkId = (body.linkId as string | undefined)?.trim() ?? '';
    if (!linkId) {
      return jsonResponse({ ok: false, error: 'missing_link_id' }, 400, corsHeaders);
    }
    const res = await resolveAllowedModelIdsForGuestLink(admin, linkId);
    if (!res.ok) {
      return jsonResponse({ ok: false, error: res.error }, res.status, corsHeaders);
    }
    allowed = res.modelIds;
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
    allowed = res.modelIds;
  }

  if (allowed.size === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }

  // 2. Filter requested paths against the allowlist.
  // We always preserve the original path string as the key in the response so
  // the client can map signed URL → original entry deterministically.
  const validPaths: string[] = [];
  for (const raw of rawPaths) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const modelId = extractModelIdFromPath(trimmed);
    if (!modelId) continue;
    if (!allowed.has(modelId)) continue;
    validPaths.push(trimmed);
  }

  if (validPaths.length === 0) {
    return jsonResponse({ ok: true, ttl: SIGNED_URL_TTL_SECONDS, signed: {} }, 200, corsHeaders);
  }

  // 3. Sign all valid paths in a single batch call.
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
      // Skip silently — the path is valid in our allowlist but the object does
      // not exist in storage (e.g. mirror column drift). Caller will see no
      // entry in the response map and can render a placeholder.
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
});
