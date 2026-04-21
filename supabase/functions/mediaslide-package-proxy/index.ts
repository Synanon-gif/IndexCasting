/**
 * Edge Function: mediaslide-package-proxy
 *
 * Server-seitiger HTTP-Proxy für den MediaSlide-Package-Import. Browser
 * koennen `https://*.mediaslide.com/package/...` nicht direkt fetchen, weil
 * MediaSlide keine `Access-Control-Allow-Origin`-Header sendet. Diese
 * Edge Function laeuft serverseitig (kein CORS-Constraint zur Origin) und
 * liefert das HTML zurueck an unsere Web-App.
 *
 * Sicherheits-Constraints:
 *   1. JWT-Auth Pflicht (kein anonymer Aufruf, kein offener Open-Proxy).
 *   2. Caller MUSS Mitglied einer Agency-Org sein (`get_my_org_context`),
 *      sonst 403. Verhindert Missbrauch durch Nicht-Agency-User.
 *   3. URL-Allowlist: Host = `*.mediaslide.com`, Pfad =
 *      `/package/view/<digits>/<hex>/<digits>/<hex>` ODER
 *      `/package/viewBook` (mit Query-Validation).
 *   4. Method = GET only (kein Schreibzugriff).
 *   5. Response-Body ist text/html; wir leiten ihn als String weiter, kein
 *      Binary-Streaming, kein File-Upload-Pfad.
 *   6. Optionaler `cookie`-String wird 1:1 weitergereicht; der Client
 *      verwaltet sein eigenes Mini-Cookie-Jar (PHPSESSID) zwischen
 *      Listen- und Book-Requests.
 *   7. Capability-Hashes in der URL werden in Logs maskiert.
 *   8. Single-Request-Timeout 12s; Retries macht der Client.
 *   9. CORS auf bekannte Index-Casting-Origins beschraenkt.
 *
 * Endpoint: POST /mediaslide-package-proxy
 * Body: { url: string, cookie?: string, referer?: string }
 * Response: { ok: true, status: number, body: string, setCookie: string | null }
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
  'IndexCasting/MediaSlidePackageImporter (+https://indexcasting.com)';

const REQUEST_TIMEOUT_MS = 12_000;

const PACKAGE_VIEW_PATH = /^\/package\/view\/\d+\/[0-9a-f]+\/\d+\/[0-9a-f]+\/?$/i;
const PACKAGE_VIEWBOOK_PATH = /^\/package\/viewBook\/?$/i;

type ProxyPayload = {
  url?: unknown;
  cookie?: unknown;
  referer?: unknown;
};

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

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Maskiert Capability-Hash-Pfadsegmente (8+ Hex-Zeichen) in URLs fuer sichere Logs.
 * Gespiegelt aus `src/services/mediaslidePackageFetcher.ts::redactPackageUrl`.
 */
function redactUrl(raw: string): string {
  try {
    return raw.replace(/\/[0-9a-f]{8,}(?=\/|\?|$)/gi, '/REDACTED');
  } catch {
    return '[redacted-url]';
  }
}

/**
 * Validiert Ziel-URL strikt:
 *  - https only
 *  - Host endet auf `.mediaslide.com`
 *  - Pfad ist `/package/view/...` ODER `/package/viewBook`
 *  - Bei viewBook: Query-Parameter `package_id`, `hash`, `package_recipient_id`,
 *    `recipient_hash`, `model_picture_category_id` sind Pflicht und passen ins
 *    erwartete Format (digits / hex).
 */
function validateTargetUrl(raw: string): URL | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') return { error: 'invalid_protocol' };
  if (!parsed.hostname.endsWith('.mediaslide.com')) {
    return { error: 'host_not_allowed' };
  }
  if (PACKAGE_VIEW_PATH.test(parsed.pathname)) {
    if (parsed.search && parsed.search.length > 0) {
      // /package/view darf keine Query haben — sonst Versuch, andere Endpoints zu hitten.
      return { error: 'unexpected_query_on_view' };
    }
    return parsed;
  }
  if (PACKAGE_VIEWBOOK_PATH.test(parsed.pathname)) {
    const required = [
      'package_id',
      'hash',
      'package_recipient_id',
      'recipient_hash',
      'model_picture_category_id',
    ] as const;
    for (const key of required) {
      const v = parsed.searchParams.get(key);
      if (!v) return { error: `missing_query:${key}` };
    }
    if (!/^\d+$/.test(parsed.searchParams.get('package_id') ?? '')) {
      return { error: 'invalid_query:package_id' };
    }
    if (!/^[0-9a-f]+$/i.test(parsed.searchParams.get('hash') ?? '')) {
      return { error: 'invalid_query:hash' };
    }
    if (!/^\d+$/.test(parsed.searchParams.get('package_recipient_id') ?? '')) {
      return { error: 'invalid_query:package_recipient_id' };
    }
    if (!/^[0-9a-f]+$/i.test(parsed.searchParams.get('recipient_hash') ?? '')) {
      return { error: 'invalid_query:recipient_hash' };
    }
    if (!/^\d+$/.test(parsed.searchParams.get('model_picture_category_id') ?? '')) {
      return { error: 'invalid_query:model_picture_category_id' };
    }
    return parsed;
  }
  return { error: 'path_not_allowed' };
}

/**
 * Cookie-Header wird 1:1 weitergereicht. Wir akzeptieren NUR Cookies, die
 * aussehen wie `name=value; name2=value2` (kein CRLF, keine Header-Injection).
 */
function sanitizeCookieHeader(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 4096) return null;
  if (/[\r\n]/.test(trimmed)) return null;
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Referer wird 1:1 weitergereicht, aber nur wenn er auf dieselbe Mediaslide-
 * Domain zeigt wie die Ziel-URL — sonst NULL.
 */
function sanitizeReferer(raw: unknown, target: URL): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  try {
    const r = new URL(trimmed);
    if (r.protocol !== 'https:') return null;
    if (r.hostname !== target.hostname) return null;
    return r.toString();
  } catch {
    return null;
  }
}

Deno.serve(
  withObservability('mediaslide-package-proxy', async (req: Request): Promise<Response> => {
    const cors = getCorsHeaders(req);

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: cors });
    }
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, cors);
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[mediaslide-package-proxy] missing SUPABASE_URL/SUPABASE_ANON_KEY');
      return jsonResponse({ ok: false, error: 'service_misconfigured' }, 503, cors);
    }

    // ── 1. Auth: User MUSS angemeldet sein ──────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401, cors);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401, cors);
    }

    // ── 2. Caller MUSS Agency-Org-Member sein ──────────────────────────
    const { data: orgCtxRaw, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
    if (orgCtxErr) {
      console.error('[mediaslide-package-proxy] org-context error', orgCtxErr.message);
      return jsonResponse({ ok: false, error: 'org_context_unavailable' }, 403, cors);
    }
    const rows = Array.isArray(orgCtxRaw) ? orgCtxRaw : orgCtxRaw ? [orgCtxRaw] : [];
    type OrgCtxRow = { organization_id?: string; org_type?: string };
    const isAgencyMember = (rows as OrgCtxRow[]).some((r) => r.org_type === 'agency');
    if (!isAgencyMember) {
      return jsonResponse({ ok: false, error: 'not_agency_member' }, 403, cors);
    }

    // ── 3. Payload parsen + Ziel-URL validieren ─────────────────────────
    let payload: ProxyPayload;
    try {
      payload = (await req.json()) as ProxyPayload;
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400, cors);
    }
    if (typeof payload?.url !== 'string') {
      return jsonResponse({ ok: false, error: 'missing_url' }, 400, cors);
    }
    const validated = validateTargetUrl(payload.url);
    if (!('href' in validated)) {
      return jsonResponse(
        { ok: false, error: `target_invalid:${validated.error}` },
        400,
        cors,
      );
    }
    const targetUrl = validated;
    const cookieHeader = sanitizeCookieHeader(payload.cookie);
    const refererHeader = sanitizeReferer(payload.referer, targetUrl);

    // ── 4. Upstream-Fetch mit Timeout ──────────────────────────────────
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    const upstreamHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en;q=1.0',
    };
    if (cookieHeader) upstreamHeaders.Cookie = cookieHeader;
    if (refererHeader) upstreamHeaders.Referer = refererHeader;
    if (PACKAGE_VIEWBOOK_PATH.test(targetUrl.pathname)) {
      upstreamHeaders['X-Requested-With'] = 'XMLHttpRequest';
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === 'AbortError';
      console.warn('[mediaslide-package-proxy] upstream-fail', {
        url: redactUrl(targetUrl.toString()),
        aborted,
        userId: user.id,
      });
      return jsonResponse(
        { ok: false, error: aborted ? 'upstream_timeout' : 'upstream_unreachable' },
        502,
        cors,
      );
    }
    clearTimeout(timer);

    // Set-Cookie sammeln (Deno: getSetCookie)
    const headers = upstreamRes.headers as Headers;
    let setCookie: string | null = null;
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === 'function') {
      const arr = getSetCookie.call(headers);
      if (arr.length > 0) setCookie = arr.join(', ');
    } else {
      setCookie = headers.get('set-cookie');
    }

    // Body als Text einlesen. Defensives Limit: Mediaslide-Packagelisten sind
    // typischerweise <500KB; wir cappen bei 5MB, um Edge-Function-Memory zu schuetzen.
    const MAX_BODY_BYTES = 5 * 1024 * 1024;
    const buf = new Uint8Array(await upstreamRes.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) {
      return jsonResponse(
        { ok: false, error: 'upstream_body_too_large' },
        502,
        cors,
      );
    }
    const body = new TextDecoder('utf-8').decode(buf);

    console.log('[mediaslide-package-proxy] ok', {
      url: redactUrl(targetUrl.toString()),
      status: upstreamRes.status,
      bytes: buf.byteLength,
      userId: user.id,
    });

    return jsonResponse(
      {
        ok: true,
        status: upstreamRes.status,
        body,
        setCookie,
      },
      200,
      cors,
    );
  }),
);
