/**
 * Edge Function: send-invite
 *
 * Sendet transaktionale Einladungs-Emails für alle drei Invite-Flows:
 *  - org_invitation: Agency Owner lädt Booker ein / Client Owner lädt Employee ein
 *  - model_claim:    Agency hat ein Model-Profil erstellt und lädt das Model ein, seinen Account zu erstellen
 *
 * Sicherheit:
 *  - Caller MUSS authentifiziert sein (JWT-Verifizierung via Supabase Auth)
 *  - RESEND_API_KEY liegt nur in Supabase Secrets — nie im Frontend
 *  - Rate-Limiting: max. 1 Email pro (to+type) Kombination alle 60 s (DB-gestützt nicht implementiert,
 *    wird durch Supabase Edge Function Rate Limits abgedeckt)
 *
 * Deployed via:
 *   npx supabase functions deploy send-invite --no-verify-jwt --project-ref ispkfdqzjrfrilosoklu
 *
 * Env vars (Supabase Secrets):
 *   RESEND_API_KEY          — Resend API Key (re_...)
 *   SUPABASE_URL            — auto-injected by Supabase
 *   SUPABASE_ANON_KEY       — auto-injected by Supabase
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_APP_BASE_URL = 'https://index-casting.com';
const FROM_EMAIL     = 'Index Casting <noreply@index-casting.com>';

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

interface SendInvitePayload {
  type: 'org_invitation' | 'model_claim';
  to: string;
  token: string;
  inviterName?: string;
  orgName?: string;
  modelName?: string;
  /** Org invitation only: Booker (agency) vs Employee (client). */
  invite_role?: 'booker' | 'employee';
  /** Disambiguates multi-org users: must be one of the caller's organization_ids from get_my_org_context(). */
  organization_id?: string;
}

type OrgCtxRow = {
  organization_id?: string;
  org_member_role?: string;
  org_type?: string;
};

type InvitationRowForDispatch = {
  organization_id: string;
  email: string;
  role: 'booker' | 'employee';
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function resolveAppBaseUrl(): string {
  const raw = Deno.env.get('APP_BASE_URL')?.trim();
  if (!raw) return DEFAULT_APP_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn('[send-invite] APP_BASE_URL has unsupported protocol, using default');
      return DEFAULT_APP_BASE_URL;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    console.warn('[send-invite] APP_BASE_URL is invalid, using default');
    return DEFAULT_APP_BASE_URL;
  }
}

// ─── HTML Email Templates ──────────────────────────────────────────────────

function buildOrgInvitationEmail(params: {
  to: string;
  orgName: string;
  inviterName: string;
  role: 'booker' | 'employee' | string;
  inviteUrl: string;
}): { subject: string; html: string } {
  const roleLabel = params.role === 'booker' ? 'Booker' : params.role === 'employee' ? 'Employee' : 'Member';
  const subject   = `Invitation: join ${params.orgName} on Index Casting`;

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
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111111;">Join an existing team</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444444;">
                <strong>${params.inviterName}</strong> has invited you to join
                <strong>${params.orgName}</strong> as a <strong>${roleLabel}</strong> on Index Casting.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444444;">
                This is a team invitation (not a normal self-service sign-up).
                Click the button below to open the invitation and create or sign in to your account.
                This link expires in 48 hours.
              </p>
              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#444444;">
                If you are asked to confirm your email, complete that step, then sign in.
                Your membership is finalized on your first successful sign-in.
                If something does not look right, open this same invitation link again before it expires.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#111111;border-radius:8px;">
                    <a href="${params.inviteUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Open Team Invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;font-size:12px;color:#888888;">
                Or copy this link into your browser:<br />
                <span style="word-break:break-all;color:#555555;">${params.inviteUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.5;">
                You received this email because someone invited you to join an existing organization on Index Casting.<br />
                If you did not expect this invitation, you can safely ignore this email.
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

function buildModelClaimEmail(params: {
  to: string;
  agencyName: string;
  modelName: string;
  claimUrl: string;
}): { subject: string; html: string } {
  const subject = `Model profile claim: ${params.agencyName} · Index Casting`;

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
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111111;">Claim your model profile</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444444;">
                <strong>${params.agencyName}</strong> has created a model profile for
                <strong>${params.modelName}</strong> on Index Casting.
              </p>
              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#444444;">
                This link is for model profile claiming only (not a team invite as Booker/Employee).
                Create your account to access your profile, manage your portfolio, and connect with clients.
                This invitation link expires in 30 days.
              </p>
              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#444444;">
                If you are prompted to confirm your email, complete that step, then sign in.
                Use the same &quot;Create My Account&quot; invitation link if your profile does not connect automatically after your first login.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#111111;border-radius:8px;">
                    <a href="${params.claimUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Create My Account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;font-size:12px;color:#888888;">
                Or copy this link into your browser:<br />
                <span style="word-break:break-all;color:#555555;">${params.claimUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.5;">
                You received this email because a modelling agency created a model profile claim on Index Casting.<br />
                If you do not know ${params.agencyName}, you can safely ignore this email.
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

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // ── Auth: Caller MUSS authentifiziert sein ─────────────────────────────────
  const supabaseUrl  = Deno.env.get('SUPABASE_URL');
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnon) {
    console.error('[send-invite] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return jsonResponse({ error: 'service_misconfigured' }, 503, corsHeaders);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase   = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return jsonResponse({ error: 'unauthorized' }, 401, corsHeaders);
  }

  // ── Parse Body ─────────────────────────────────────────────────────────────
  let body: SendInvitePayload;
  try {
    body = await req.json() as SendInvitePayload;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
  }

  const {
    type,
    to,
    token,
    inviterName,
    orgName,
    modelName,
    invite_role: bodyInviteRole,
    organization_id: bodyOrgId,
  } = body;

  if (!type || !to || !token) {
    return jsonResponse({ error: 'missing_required_fields' }, 400, corsHeaders);
  }

  if (!['org_invitation', 'model_claim'].includes(type)) {
    return jsonResponse({ error: 'invalid_type' }, 400, corsHeaders);
  }

  // Einfache Email-Validierung
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return jsonResponse({ error: 'invalid_email' }, 400, corsHeaders);
  }

  let invitationContext: InvitationRowForDispatch | null = null;
  if (type === 'org_invitation') {
    const { data: inviteRow, error: inviteErr } = await supabase
      .from('invitations')
      .select('organization_id, email, role, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (inviteErr) {
      console.error('[send-invite] failed to load invitation context', inviteErr);
      return jsonResponse({ error: 'invitation_context_unavailable' }, 409, corsHeaders);
    }
    if (!inviteRow) {
      return jsonResponse({ error: 'invitation_not_found' }, 404, corsHeaders);
    }
    if ((inviteRow as { status?: string }).status !== 'pending') {
      return jsonResponse({ error: 'invitation_not_pending' }, 409, corsHeaders);
    }
    if (!((inviteRow as { role?: string }).role === 'booker' || (inviteRow as { role?: string }).role === 'employee')) {
      return jsonResponse({ error: 'invitation_role_invalid' }, 409, corsHeaders);
    }

    invitationContext = {
      organization_id: (inviteRow as { organization_id: string }).organization_id,
      email: (inviteRow as { email: string }).email,
      role: (inviteRow as { role: 'booker' | 'employee' }).role,
    };

    if (normalizeEmail(invitationContext.email) !== normalizeEmail(to)) {
      return jsonResponse({ error: 'invitation_email_mismatch' }, 409, corsHeaders);
    }
    if (bodyInviteRole && bodyInviteRole !== invitationContext.role) {
      return jsonResponse({ error: 'invitation_role_mismatch' }, 409, corsHeaders);
    }
    if (bodyOrgId && bodyOrgId !== invitationContext.organization_id) {
      return jsonResponse({ error: 'invitation_org_mismatch' }, 409, corsHeaders);
    }
  }

  // ── Authorization: Role check (Regel 8/10 — Owner-Exklusivrecht) ───────────
  // org_invitation: only org Owners may invite new members (agency→booker,
  //   client→employee). Bookers/Employees must NOT be able to send invites.
  // model_claim: any agency member (owner or booker) may send model claim
  //   emails, since model management is a shared agency responsibility.
  {
    const { data: orgCtxRaw, error: orgCtxErr } = await supabase.rpc('get_my_org_context');
    if (orgCtxErr) {
      console.error('[send-invite] get_my_org_context error:', orgCtxErr);
      return jsonResponse({ error: 'org_context_unavailable' }, 403, corsHeaders);
    }
    const orgCtxRows = Array.isArray(orgCtxRaw) ? orgCtxRaw : (orgCtxRaw ? [orgCtxRaw] : []);
    const rows = orgCtxRows as OrgCtxRow[];

    let orgCtx: OrgCtxRow | undefined;
    const rawOrgId = invitationContext?.organization_id
      ?? (typeof bodyOrgId === 'string' ? bodyOrgId.trim() : '');
    const requestedOrg = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId)
      ? rawOrgId
      : undefined;

    if (requestedOrg) {
      orgCtx = rows.find((r) => r.organization_id === requestedOrg);
      if (!orgCtx) {
        console.warn('[send-invite] organization_id not in caller memberships', { userId: user.id, requestedOrg });
        return jsonResponse({ error: 'not_member_of_organization' }, 403, corsHeaders);
      }
    } else {
      if (rows.length > 1) {
        console.warn(
          '[send-invite] caller has multiple org memberships; using oldest row — pass organization_id to disambiguate',
          { userId: user.id, count: rows.length },
        );
      }
      orgCtx = rows[0];
    }

    if (type === 'org_invitation') {
      // Only owners may invite — Regel 8: "Agency Owner: Als einzige Rolle: Bookers einladen"
      if (!orgCtx || orgCtx.org_member_role !== 'owner') {
        console.warn('[send-invite] org_invitation rejected: caller is not owner', {
          userId: user.id,
          role: orgCtx?.org_member_role,
        });
        return jsonResponse({ error: 'owner_only' }, 403, corsHeaders);
      }
    }

    if (type === 'model_claim') {
      // Agency org members (owner or booker) may send model claim emails.
      // Models and clients must not be able to trigger model claim emails.
      if (!orgCtx || orgCtx.org_type !== 'agency') {
        console.warn('[send-invite] model_claim rejected: caller is not in agency org', {
          userId: user.id,
          orgType: orgCtx?.org_type,
        });
        return jsonResponse({ error: 'agency_only' }, 403, corsHeaders);
      }
    }
  }

  // ── Resend API Key ─────────────────────────────────────────────────────────
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.error('[send-invite] RESEND_API_KEY is not set');
    return jsonResponse({ error: 'email_service_not_configured' }, 503, corsHeaders);
  }

  // ── Build Email ────────────────────────────────────────────────────────────
  let subject: string;
  let html: string;
  const appBaseUrl = resolveAppBaseUrl();

  if (type === 'org_invitation') {
    const inviteUrl = `${appBaseUrl}/?invite=${encodeURIComponent(token)}`;
    const roleForEmail = invitationContext?.role ?? (bodyInviteRole === 'employee' ? 'employee' : 'booker');
    const result    = buildOrgInvitationEmail({
      to,
      orgName:     orgName    || 'your organization',
      inviterName: inviterName || 'A team member',
      role:        roleForEmail,
      inviteUrl,
    });
    subject = result.subject;
    html    = result.html;
  } else {
    // model_claim
    const claimUrl = `${appBaseUrl}/?model_invite=${encodeURIComponent(token)}`;
    const result   = buildModelClaimEmail({
      to,
      agencyName: orgName   || 'Your agency',
      modelName:  modelName || 'you',
      claimUrl,
    });
    subject = result.subject;
    html    = result.html;
  }

  // ── Send via Resend ────────────────────────────────────────────────────────
  try {
    const resendRes = await fetch(RESEND_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      console.error('[send-invite] Resend API error:', resendRes.status, errorText);
      return jsonResponse({ error: 'email_send_failed', detail: errorText }, 502, corsHeaders);
    }

    const resendData = await resendRes.json();
    console.log('[send-invite] Email sent:', type, 'to:', to.replace(/@.*/, '@…'), 'id:', (resendData as { id?: string }).id);

    return jsonResponse({ ok: true, email_id: (resendData as { id?: string }).id }, 200, corsHeaders);
  } catch (e) {
    console.error('[send-invite] Fetch exception:', e);
    return jsonResponse({ error: 'email_send_exception' }, 500, corsHeaders);
  }
});
