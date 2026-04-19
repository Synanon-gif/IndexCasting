/**
 * Edge Function: member-remove
 *
 * Removes a member from an organization and immediately revokes all active
 * sessions for that user (global sign-out via Admin API).
 *
 * EXPLOIT-H1 fix: without this, a removed member retains JWT-level access
 * for up to 60 minutes (JWT TTL) and their existing Realtime subscriptions
 * remain active until the WebSocket is closed.
 *
 * Authorization:
 *   - Caller must be an owner of the target organization.
 *   - A member cannot remove themselves (use dissolve / leave flows instead).
 *
 * Deploy:
 *   supabase functions deploy member-remove --no-verify-jwt
 *
 * Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withObservability } from '../_shared/logger.ts';

const ALLOWED_ORIGINS = [
  'https://index-casting.com',
  'https://www.index-casting.com',
  'https://indexcasting.com',
];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

Deno.serve(withObservability('member-remove', async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing environment configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify caller identity via anon client (their JWT).
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !callerUser) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json() as { targetUserId?: string; organizationId?: string };
    const { targetUserId, organizationId } = body ?? {};

    if (!targetUserId || !organizationId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing targetUserId or organizationId in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!UUID_REGEX.test(targetUserId) || !UUID_REGEX.test(organizationId)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid UUID format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Prevent self-removal — use leave/dissolve flows for that.
    if (callerUser.id === targetUserId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Cannot remove yourself; use the leave or dissolve flow' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Authorization: caller must be an owner of the target organization.
    const { data: callerMembership, error: membershipError } = await anonClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', callerUser.id)
      .maybeSingle();

    if (membershipError || !callerMembership) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Forbidden: caller is not a member of this organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if ((callerMembership as { role: string }).role !== 'owner') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Forbidden: only organization owners may remove members' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify the target is actually a member of this organization.
    const { data: targetMembership, error: targetError } = await anonClient
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (targetError || !targetMembership) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Target user is not a member of this organization' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Use service role client for privileged operations.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Delete the organization_members row first to ensure RLS takes effect
    //    for any subsequent queries from the removed user.
    const { error: deleteError } = await adminClient
      .from('organization_members')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', targetUserId);

    if (deleteError) {
      console.error('member-remove: delete membership error:', deleteError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to remove membership' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Force-revoke all active sessions for the removed user (EXPLOIT-H1 fix).
    //    'global' scope signs out all devices, not just the current session.
    const { error: signOutError } = await adminClient.auth.admin.signOut(targetUserId, 'global');
    if (signOutError) {
      // Non-fatal: the membership row is already deleted. RLS will block new
      // queries once the JWT expires (~60 min). Log but continue.
      console.warn('member-remove: session revoke warning (membership already deleted):', signOutError);
    }

    // 3. Write an audit trail entry via the service role (bypasses RLS on audit_trail).
    await adminClient.from('audit_trail').insert({
      user_id:     callerUser.id,
      org_id:      organizationId,
      action_type: 'member_removed',
      entity_type: 'organization_member',
      new_data:    { removed_user_id: targetUserId, removed_by: callerUser.id },
    }).catch((e: unknown) => console.error('member-remove: audit trail insert failed (non-fatal):', e));

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('member-remove: unhandled exception:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}));
