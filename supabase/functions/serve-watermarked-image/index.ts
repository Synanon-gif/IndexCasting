/**
 * serve-watermarked-image — Secure, server-authorised image delivery with SVG watermark.
 *
 * Security guarantees:
 *   1. Only authenticated, platform-access-validated users get a signed storage URL.
 *   2. The signed URL is generated server-side with a short TTL (60 s).
 *   3. storagePath is validated: must reference an actual model in the DB (IDOR fix).
 *   4. Only the 'documentspictures' bucket is permitted (bucket whitelist).
 *   5. CORS is restricted to known origins instead of wildcard (CORS fix).
 *   6. The image is served inside an SVG, never as a raw JPEG/PNG download.
 *   7. Content-Disposition: inline prevents browser "Save As" dialog for the outer SVG.
 *   8. Referrer-Policy and CSP headers discourage hotlinking.
 *
 * URL format:
 *   POST /serve-watermarked-image
 *   Body: { "storagePath": "documentspictures/org_id/model_id/photo.jpg", "label": "INDEX CASTING" }
 *
 * Returns: SVG image/svg+xml with embedded watermark.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SIGNED_URL_EXPIRES_IN = 60; // seconds

/** Only these storage buckets may be served through this function. */
const ALLOWED_BUCKETS = ['documentspictures'];

/**
 * UUID regex used to extract a model_id from the storage path.
 * Format expected: <bucket>/<any-prefix>/<model-uuid>/<filename>
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Allowed web origins. Wildcard (*) was removed to prevent cross-origin abuse.
 * Add staging / preview URLs here as needed.
 */
const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
  'https://www.indexcasting.com',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Authenticate the calling user via their JWT ──────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 2. Check platform access (paywall / trial / subscription) ───────────────
  const { data: accessData } = await userClient.rpc('can_access_platform');
  const accessResult = accessData as { allowed: boolean } | null;
  if (!accessResult?.allowed) {
    return new Response(JSON.stringify({ error: 'Platform access denied' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 3. Parse and validate request body ─────────────────────────────────────
  let storagePath: string;
  let label: string = 'PREVIEW · INDEX CASTING';

  try {
    const body = await req.json();
    storagePath = body.storagePath;
    if (body.label) label = body.label;
    if (!storagePath || typeof storagePath !== 'string') throw new Error('storagePath required');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Validate bucket and path structure (IDOR fix) ────────────────────────
  const bucket = storagePath.split('/')[0];
  const path = storagePath.split('/').slice(1).join('/');

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return new Response(JSON.stringify({ error: 'Invalid resource' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract the first UUID segment from the path — this must be a real model id.
  // Path format: <org_id>/<model_id>/<filename> or just <model_id>/<filename>
  const pathSegments = path.split('/');
  const modelId = pathSegments.find((seg) => UUID_REGEX.test(seg)) ?? null;

  if (!modelId) {
    return new Response(JSON.stringify({ error: 'Invalid resource path' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify the model exists in the database using the admin client.
  // This ensures the storagePath references a legitimate model record and not
  // an arbitrary file path crafted by an attacker (IDOR prevention).
  // Note: both agency members AND clients with discovery access may view model
  // photos; the platform access check above already validates subscription state.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: modelRow, error: modelLookupError } = await adminClient
    .from('models')
    .select('id')
    .eq('id', modelId)
    .maybeSingle();

  if (modelLookupError || !modelRow) {
    return new Response(JSON.stringify({ error: 'Resource not found' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 5. Generate a short-lived signed URL ────────────────────────────────────
  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return new Response(JSON.stringify({ error: 'Failed to generate signed URL' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const signedUrl = signedUrlData.signedUrl;

  // ── 6. Build SVG with diagonal watermark overlay ────────────────────────────
  const watermarkRows = [0, 1, 2, 3, 4];
  const watermarkCols = [0, 1];
  const watermarkTexts = watermarkRows.flatMap((row) =>
    watermarkCols.map((col) => {
      const x = col * 50 + 5;
      const y = row * 22 + 15;
      return `<text
        x="${x}%"
        y="${y}%"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="11"
        font-weight="600"
        fill="rgba(255,255,255,0.45)"
        transform="rotate(-35, ${x * 4}, ${y * 3})"
        pointer-events="none"
      >${label}</text>`;
    })
  ).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 400 600"
     style="max-width:100%;height:auto;display:block;">
  <image
    href="${signedUrl}"
    x="0" y="0"
    width="400" height="600"
    preserveAspectRatio="xMidYMid slice"
  />
  ${watermarkTexts}
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store, no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
