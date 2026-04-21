/**
 * Edge Function: package-image-proxy
 *
 * Server-seitiger BINARY-Proxy fuer den MediaSlide-/Netwalk-Package-Import-
 * Bild-Mirror. MediaSlide haengt seine Bilder unter
 * `https://mediaslide-europe.storage.googleapis.com/...`; dieser GCS-Bucket
 * sendet keinen `Access-Control-Allow-Origin`-Header. Ein direkter
 * `fetch(url)` aus `https://www.index-casting.com` schlaegt deshalb mit
 * `download_network` (CORS) fehl, BEVOR `packageImagePersistence` ueberhaupt
 * den HTTP-Status sehen kann.
 *
 * Diese Funktion fuehrt das GET serverseitig (kein CORS), validiert host +
 * content-type + size, und streamt das Bild zurueck an den Browser. Body
 * bleibt binaer (kein base64 / JSON-wrapping → kein 33% Overhead).
 *
 * Sicherheits-Constraints:
 *   1. JWT-Auth Pflicht.
 *   2. Caller MUSS Mitglied einer `agency`-Org sein (`get_my_org_context`).
 *   3. Host-Allowlist (siehe ALLOWED_HOSTS_*). Aktuell nur MediaSlide-Pfad
 *      (Direkt-MediaSlide-Domain + Mediaslide-GCS-Bucket). Fuer Netwalk
 *      wird die Liste hier erweitert, wenn der echte CDN-Host bekannt ist.
 *   4. URL-Whitelist: nur https, content-type aus IMAGE_MIME_WHITELIST.
 *   5. Body-Cap 25 MB (gleicher Wert wie `PACKAGE_IMAGE_DOWNLOAD_LIMIT_BYTES`).
 *   6. Single-Request-Timeout 15 s.
 *   7. KEIN Cookie / Bearer / Auth wird upstream weitergegeben — der
 *      Provider-CDN soll uns wie einen anonymen Client behandeln (gleiches
 *      Invariant wie das vorhandene `packageImagePersistence.ts`).
 *   8. CORS auf Index-Casting-Origins beschraenkt.
 *
 * Endpoint: POST /package-image-proxy
 * Body: { url: string }
 * Response (success): 200, body = binary image bytes,
 *   Content-Type = upstream image/* (jpeg/png/webp/heic/heif).
 * Response (error):  4xx/5xx, body = JSON { error: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
  'https://www.indexcasting.com',
];

const USER_AGENT =
  'IndexCasting/PackageImageProxy (+https://indexcasting.com)';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Host-Allowlist. Akzeptiert wird:
 *  - Exakter Match (z. B. `mediaslide-europe.storage.googleapis.com`).
 *  - Subdomain-Match auf `.mediaslide.com` (jeder Mediaslide-Tenant inkl.
 *    Sub-Pfad).
 *
 * KEINE Wildcards auf `googleapis.com` insgesamt — wir whitelisten nur die
 * MediaSlide-Bucket-Subdomain. Das verhindert, dass diese Funktion als
 * Open-Proxy fuer beliebige Google-CDN-Inhalte missbraucht wird.
 */
const ALLOWED_EXACT_HOSTS = new Set<string>([
  'mediaslide-europe.storage.googleapis.com',
]);
const ALLOWED_SUFFIX_HOSTS: string[] = [
  '.mediaslide.com',
];

/**
 * MIME-Whitelist fuer den Upstream-Response. Identisch zu
 * `ALLOWED_DOWNLOAD_CONTENT_TYPES` in `packageImagePersistence.ts`.
 */
const IMAGE_MIME_WHITELIST = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

type ProxyPayload = { url?: unknown };

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

function jsonError(
  message: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function maskUrl(raw: string): string {
  try {
    return raw.replace(/\/[0-9a-f]{8,}(?=\/|\?|$)/gi, '/REDACTED');
  } catch {
    return '[redacted-url]';
  }
}

function isHostAllowed(host: string): boolean {
  if (ALLOWED_EXACT_HOSTS.has(host)) return true;
  for (const suffix of ALLOWED_SUFFIX_HOSTS) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

function validateUrl(raw: string): URL | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') return { error: 'invalid_protocol' };
  if (!isHostAllowed(parsed.hostname)) return { error: 'host_not_allowed' };
  return parsed;
}

Deno.serve(
  withObservability('package-image-proxy', async (req: Request): Promise<Response> => {
    const cors = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: cors });
    }
    if (req.method !== 'POST') {
      return jsonError('method_not_allowed', 405, cors);
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[package-image-proxy] missing SUPABASE_URL/SUPABASE_ANON_KEY');
      return jsonError('service_misconfigured', 503, cors);
    }

    // ── 1. Auth ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return jsonError('unauthorized', 401, cors);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return jsonError('unauthorized', 401, cors);

    // ── 2. Agency-Membership ────────────────────────────────────────────
    const { data: orgCtxRaw, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
    if (orgCtxErr) {
      console.error('[package-image-proxy] org-context error', orgCtxErr.message);
      return jsonError('org_context_unavailable', 403, cors);
    }
    const rows = Array.isArray(orgCtxRaw) ? orgCtxRaw : orgCtxRaw ? [orgCtxRaw] : [];
    type OrgCtxRow = { org_type?: string };
    const isAgencyMember = (rows as OrgCtxRow[]).some((r) => r.org_type === 'agency');
    if (!isAgencyMember) return jsonError('not_agency_member', 403, cors);

    // ── 3. Payload ──────────────────────────────────────────────────────
    let payload: ProxyPayload;
    try {
      payload = (await req.json()) as ProxyPayload;
    } catch {
      return jsonError('invalid_json', 400, cors);
    }
    if (typeof payload?.url !== 'string') {
      return jsonError('missing_url', 400, cors);
    }

    const validated = validateUrl(payload.url);
    if (!('href' in validated)) {
      return jsonError(`target_invalid:${validated.error}`, 400, cors);
    }
    const targetUrl = validated;

    // ── 4. Upstream-Fetch (anonym, KEINE Cookies / Auth) ────────────────
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/*',
        },
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === 'AbortError';
      console.warn('[package-image-proxy] upstream-fail', {
        url: maskUrl(targetUrl.toString()),
        aborted,
        userId: user.id,
      });
      return jsonError(
        aborted ? 'upstream_timeout' : 'upstream_unreachable',
        502,
        cors,
      );
    }
    clearTimeout(timer);

    if (!upstreamRes.ok) {
      // Upstream-HTTP-Status spiegeln, damit Client den Reason klassifizieren
      // kann (download_http_error mit dem konkreten Status).
      const status = upstreamRes.status;
      // Body wegwerfen, sonst leakt Provider-Errorseite.
      try {
        await upstreamRes.body?.cancel();
      } catch {
        // ignore
      }
      console.warn('[package-image-proxy] upstream-non-2xx', {
        url: maskUrl(targetUrl.toString()),
        status,
        userId: user.id,
      });
      return jsonError(`upstream_http_error:${status}`, status === 404 ? 404 : 502, cors);
    }

    // ── 5. Validate content-type + size ─────────────────────────────────
    const rawType = upstreamRes.headers.get('content-type') ?? '';
    const contentType = rawType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!IMAGE_MIME_WHITELIST.has(contentType)) {
      try {
        await upstreamRes.body?.cancel();
      } catch {
        // ignore
      }
      return jsonError(
        `invalid_content_type:${contentType || 'missing'}`,
        415,
        cors,
      );
    }

    // Optional content-length pre-check.
    const cl = upstreamRes.headers.get('content-length');
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        try {
          await upstreamRes.body?.cancel();
        } catch {
          // ignore
        }
        return jsonError('too_large', 413, cors);
      }
    }

    const buf = new Uint8Array(await upstreamRes.arrayBuffer());
    if (buf.byteLength === 0) {
      return jsonError('empty_response', 502, cors);
    }
    if (buf.byteLength > MAX_BODY_BYTES) {
      return jsonError('too_large', 413, cors);
    }

    console.log('[package-image-proxy] ok', {
      url: maskUrl(targetUrl.toString()),
      contentType,
      bytes: buf.byteLength,
      userId: user.id,
    });

    return new Response(buf, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }),
);
