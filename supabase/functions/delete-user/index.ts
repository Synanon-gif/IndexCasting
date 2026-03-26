/**
 * Edge Function: delete-user
 *
 * Permanently deletes a user from auth.users using the service_role key.
 * The service_role key is only available server-side in Edge Functions —
 * it must NEVER be exposed in the frontend bundle.
 *
 * Authorization rules:
 *   - A user may delete their OWN account (userId === caller's auth.uid()).
 *   - A platform admin (is_admin = true) may delete any account.
 *
 * Deploy:
 *   supabase functions deploy delete-user --no-verify-jwt
 *
 * Set the following secrets in Supabase dashboard → Edge Functions → Secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
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

    // Verify the caller's JWT using the anon client.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    const body = await req.json() as { userId?: string };
    const targetUserId = body?.userId;

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing userId in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const isSelf = callerUser.id === targetUserId;

    // Admins may delete any account; regular users may only delete their own.
    if (!isSelf) {
      const { data: callerProfile } = await anonClient
        .from('profiles')
        .select('is_admin')
        .eq('id', callerUser.id)
        .maybeSingle();

      if (!callerProfile?.is_admin) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Forbidden: only admins may delete other accounts' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Perform the deletion with the service role client (never exposed to browser).
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      console.error('delete-user edge function error:', deleteError);
      return new Response(
        JSON.stringify({ ok: false, error: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('delete-user edge function unhandled exception:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
