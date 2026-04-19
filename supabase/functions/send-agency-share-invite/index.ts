/**
 * Edge Function: send-agency-share-invite
 *
 * Sends a notification email to a recipient agency that an incoming
 * Agency-to-Agency Roster Share package is waiting. The recipient must
 * already have an existing agency account on Index Casting (the
 * `create_agency_share_package` RPC enforces this).
 *
 * Security:
 *  - Caller MUST be authenticated (JWT verification via Supabase Auth)
 *  - Caller MUST be a member of `sender_organization_id` (agency org)
 *  - The link_id MUST belong to the sender agency
 *  - RESEND_API_KEY only in Supabase Secrets — never in the frontend
 *
 * Deployed via:
 *   npx supabase functions deploy send-agency-share-invite --no-verify-jwt --project-ref ispkfdqzjrfrilosoklu
 *
 * Env vars (Supabase Secrets):
 *   RESEND_API_KEY    — Resend API Key (re_...)
 *   SUPABASE_URL      — auto-injected by Supabase
 *   SUPABASE_ANON_KEY — auto-injected by Supabase
 *   APP_BASE_URL      — optional override (defaults to https://index-casting.com)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_APP_BASE_URL = 'https://index-casting.com';
const FROM_EMAIL = 'Index Casting <noreply@index-casting.com>';

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
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

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface AgencyShareInvitePayload {
  link_id: string;
  to: string;
  sender_organization_id: string;
  sender_agency_name?: string;
  recipient_agency_name?: string;
  inviter_name?: string;
  model_count?: number;
  label?: string | null;
}

function resolveAppBaseUrl(): string {
  const raw = Deno.env.get('APP_BASE_URL')?.trim();
  if (!raw) return DEFAULT_APP_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn('[send-agency-share-invite] APP_BASE_URL has unsupported protocol, using default');
      return DEFAULT_APP_BASE_URL;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    console.warn('[send-agency-share-invite] APP_BASE_URL is invalid, using default');
    return DEFAULT_APP_BASE_URL;
  }
}

function buildAgencyShareEmail(params: {
  to: string;
  senderAgencyName: string;
  recipientAgencyName: string;
  inviterName: string;
  modelCount: number;
  label: string | null;
  shareUrl: string;
}): { subject: string; html: string } {
  const subject = `${params.senderAgencyName} shared a roster package with you · Index Casting`;
  const labelLine = params.label
    ? `<p style="margin:0 0 16px;font-size:14px;color:#555555;"><em>${params.label}</em></p>`
    : '';
  const modelCountLine = params.modelCount > 0
    ? `${params.modelCount} model${params.modelCount === 1 ? '' : 's'}`
    : 'a model package';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#111111;padding:28px 40px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:2px;">INDEX CASTING</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111111;">Incoming roster share</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444444;">
                <strong>${params.inviterName}</strong> from
                <strong>${params.senderAgencyName}</strong> shared
                ${modelCountLine} with <strong>${params.recipientAgencyName}</strong>
                on Index Casting.
              </p>
              ${labelLine}
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444444;">
                Open the package to review the models, their measurements and media,
                and choose which territories you would like to represent.
              </p>
              <p style="margin:0 0 32px;font-size:14px;line-height:1.6;color:#666666;">
                This is an agency-to-agency share. The original agency remains the
                home of each model profile; you will become a co-agency for the
                territories you select.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#111111;border-radius:8px;">
                    <a href="${params.shareUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Open Roster Share
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;font-size:12px;color:#888888;">
                Or copy this link into your browser:<br />
                <span style="word-break:break-all;color:#555555;">${params.shareUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.5;">
                You received this email because another agency on Index Casting shared a
                roster package with your agency. Sign in with your existing agency
                account to open it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

Deno.serve(withObservability('send-agency-share-invite', async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnon) {
    console.error('[send-agency-share-invite] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return jsonResponse({ error: 'service_misconfigured' }, 503, corsHeaders);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return jsonResponse({ error: 'unauthorized' }, 401, corsHeaders);
  }

  let body: AgencyShareInvitePayload;
  try {
    body = await req.json() as AgencyShareInvitePayload;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
  }

  const {
    link_id,
    to,
    sender_organization_id,
    sender_agency_name,
    recipient_agency_name,
    inviter_name,
    model_count,
    label,
  } = body;

  if (!link_id || !to || !sender_organization_id) {
    return jsonResponse({ error: 'missing_required_fields' }, 400, corsHeaders);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return jsonResponse({ error: 'invalid_email' }, 400, corsHeaders);
  }

  // Authorization: caller must be member of sender_organization_id (agency org)
  // and the link_id must belong to that sender agency.
  const { data: orgCtxRaw, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
  if (orgCtxErr) {
    console.error('[send-agency-share-invite] get_my_org_context error:', orgCtxErr);
    return jsonResponse({ error: 'org_context_unavailable' }, 403, corsHeaders);
  }
  const orgCtxRows = Array.isArray(orgCtxRaw) ? orgCtxRaw : (orgCtxRaw ? [orgCtxRaw] : []);
  type OrgCtxRow = { organization_id?: string; org_type?: string };
  const ownership = (orgCtxRows as OrgCtxRow[]).find(
    (r) => r.organization_id === sender_organization_id && r.org_type === 'agency',
  );
  if (!ownership) {
    console.warn('[send-agency-share-invite] caller not member of sender agency org', {
      userId: user.id,
      sender_organization_id,
    });
    return jsonResponse({ error: 'not_member_of_sender_organization' }, 403, corsHeaders);
  }

  // Validate link belongs to caller's agency and is an agency_share row.
  const { data: linkRow, error: linkErr } = await supabase
    .from('guest_links')
    .select('id, purpose, target_agency_email, agency_id, model_ids, label')
    .eq('id', link_id)
    .maybeSingle();

  if (linkErr) {
    console.error('[send-agency-share-invite] failed to load link', linkErr);
    return jsonResponse({ error: 'link_unavailable' }, 409, corsHeaders);
  }
  if (!linkRow) {
    return jsonResponse({ error: 'link_not_found' }, 404, corsHeaders);
  }
  if ((linkRow as { purpose?: string }).purpose !== 'agency_share') {
    return jsonResponse({ error: 'link_wrong_purpose' }, 409, corsHeaders);
  }

  // Resolve caller's agency_id via organizations to confirm link.agency_id matches.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('agency_id, type')
    .eq('id', sender_organization_id)
    .maybeSingle();
  const callerAgencyId = (orgRow as { agency_id?: string } | null)?.agency_id ?? null;
  if (!callerAgencyId || callerAgencyId !== (linkRow as { agency_id?: string }).agency_id) {
    return jsonResponse({ error: 'link_does_not_belong_to_caller_agency' }, 403, corsHeaders);
  }

  // Resend
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.error('[send-agency-share-invite] RESEND_API_KEY is not set');
    return jsonResponse({ error: 'email_service_not_configured' }, 503, corsHeaders);
  }

  const appBaseUrl = resolveAppBaseUrl();
  const shareUrl = `${appBaseUrl}/?agency_share=${encodeURIComponent(link_id)}`;
  const resolvedModelCount = typeof model_count === 'number' && model_count > 0
    ? model_count
    : ((linkRow as { model_ids?: string[] }).model_ids ?? []).length;
  const resolvedLabel = (typeof label === 'string' && label.trim().length > 0)
    ? label.trim()
    : (typeof (linkRow as { label?: string | null }).label === 'string'
        ? ((linkRow as { label?: string | null }).label ?? null)
        : null);

  const { subject, html } = buildAgencyShareEmail({
    to,
    senderAgencyName: sender_agency_name?.trim() || 'Another agency',
    recipientAgencyName: recipient_agency_name?.trim() || 'your agency',
    inviterName: inviter_name?.trim() || 'A team member',
    modelCount: resolvedModelCount,
    label: resolvedLabel,
    shareUrl,
  });

  try {
    const resendRes = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      console.error('[send-agency-share-invite] Resend API error:', resendRes.status, errorText);
      return jsonResponse({ error: 'email_send_failed', detail: errorText }, 502, corsHeaders);
    }

    const resendData = await resendRes.json();
    console.log('[send-agency-share-invite] Email sent to:', to.replace(/@.*/, '@…'), 'id:', (resendData as { id?: string }).id);

    return jsonResponse({ ok: true, email_id: (resendData as { id?: string }).id }, 200, corsHeaders);
  } catch (e) {
    console.error('[send-agency-share-invite] Fetch exception:', e);
    return jsonResponse({ error: 'email_send_exception' }, 500, corsHeaders);
  }
}));
