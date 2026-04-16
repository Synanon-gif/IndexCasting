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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req: Request) => {
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

    // Validate UUID format before passing to auth.admin.deleteUser.
    // Prevents unexpected behaviour from malformed inputs (e.g. path traversal
    // attempts or injection strings). M-2 fix — Security Pentest 2026-04.
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(targetUserId)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid userId format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const isSelf = callerUser.id === targetUserId;

    // Admins may delete any account; regular users may only delete their own.
    // IMPORTANT: is_admin is column-level REVOKEd from authenticated — a direct
    // .select('is_admin') returns null even for real admins.
    // Use the SECURITY DEFINER RPC get_own_admin_flags() which bypasses the REVOKE
    // AND enforces UUID + email pinning (only the platform owner passes).
    if (!isSelf) {
      const { data: adminFlags, error: adminFlagsError } = await anonClient.rpc('get_own_admin_flags');
      if (adminFlagsError) {
        console.error('delete-user: get_own_admin_flags error:', adminFlagsError.message);
        return new Response(
          JSON.stringify({ ok: false, error: 'Forbidden: admin check failed' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const flagRow = Array.isArray(adminFlags) ? adminFlags[0] : adminFlags;
      if (!flagRow?.is_admin) {
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

    // ── GDPR: Explicit storage cleanup ────────────────────────────────────────
    // Storage objects are keyed by user-id and are NOT covered by DB cascades.
    //
    // Cascade chain (auth.users → public schema) that runs automatically:
    //   profiles (CASCADE) → organization_members, push_tokens, notifications,
    //   activity_logs, bookers, badges, consent_log, legal_acceptances,
    //   verifications, post_likes (all CASCADE).
    //   models.user_id → SET NULL (model record stays; agency owns the content).
    //   conversations: no FK to users — participant_ids UUID[] may still list this
    //   user id until a dedicated cleanup job/migration removes stale IDs.
    //
    // Storage paths that MUST be deleted explicitly:
    //   documents/{userId}/*     – option-request documents uploaded by user
    //   verifications/{userId}/  – identity verification uploads
    //
    // Intentionally NOT deleted here:
    //   model-photos/{modelId}/  – model portfolio images are owned by the agency,
    //                              not the individual user. They are removed via
    //                              deleteOrganizationData() when the agency itself
    //                              is deleted, or manually by the agency owner.
    //   chat-files/              – chat attachments are removed when the conversation
    //                              cascade-deletes the message records (FK ON DELETE CASCADE).
    const storageCleanupErrors: string[] = [];

    const storageBuckets: Array<{ bucket: string; prefix: string }> = [
      { bucket: 'documents', prefix: `documents/${targetUserId}/` },
      { bucket: 'documentspictures', prefix: `verifications/${targetUserId}/` },
    ];

    for (const { bucket, prefix } of storageBuckets) {
      try {
        let hasMore = true;
        while (hasMore) {
          const { data: objects, error: listError } = await adminClient.storage
            .from(bucket)
            .list(prefix, { limit: 1000 });

          if (listError) {
            console.error(`delete-user: storage list error (${bucket}/${prefix}):`, listError.message);
            storageCleanupErrors.push(`list:${bucket}`);
            break;
          }

          if (!objects || objects.length === 0) {
            hasMore = false;
            break;
          }

          const paths = objects.map((obj) => `${prefix}${obj.name}`);
          const { error: removeError } = await adminClient.storage.from(bucket).remove(paths);
          if (removeError) {
            console.error(`delete-user: storage remove error (${bucket}):`, removeError.message);
            storageCleanupErrors.push(`remove:${bucket}`);
            break;
          }

          if (objects.length < 1000) {
            hasMore = false;
          }
        }
      } catch (storageEx) {
        console.error(`delete-user: storage exception (${bucket}):`, storageEx);
        storageCleanupErrors.push(`exception:${bucket}`);
      }
    }

    // Remove the user from B2B conversation participant arrays before auth deletion so no
    // long-lived arrays reference this UUID (cleanup_conversation_participants only drops
    // IDs that no longer exist in auth — that runs after delete as a second pass).
    try {
      const { error: stripErr } = await adminClient.rpc('remove_user_from_conversation_participants', {
        p_user_id: targetUserId,
      });
      if (stripErr) {
        console.error('delete-user: remove_user_from_conversation_participants:', stripErr.message);
      }
    } catch (stripEx) {
      console.error('delete-user: remove_user_from_conversation_participants exception:', stripEx);
    }

    // ── Auth deletion (triggers all DB cascades) ──────────────────────────────
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      // Log internally but never expose internal error details to the caller.
      console.error('delete-user edge function error:', deleteError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to delete account. Please try again later.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let authUserStillPresent = false;
    try {
      const { data: postDeleteUser, error: verifyErr } =
        await adminClient.auth.admin.getUserById(targetUserId);
      authUserStillPresent = !verifyErr && !!postDeleteUser?.user;
      if (verifyErr && !`${verifyErr.message ?? ''}`.toLowerCase().includes('user not found')) {
        console.error('delete-user: post-delete getUserById:', verifyErr.message);
      }
    } catch (verifyEx) {
      console.error('delete-user: post-delete verify exception:', verifyEx);
    }

    // Best-effort: strip any remaining stale auth IDs from conversations.participant_ids.
    try {
      const { error: cleanupErr } = await adminClient.rpc('cleanup_conversation_participants');
      if (cleanupErr) {
        console.error('delete-user: cleanup_conversation_participants:', cleanupErr.message);
      }
    } catch (cleanupEx) {
      console.error('delete-user: cleanup_conversation_participants exception:', cleanupEx);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        verified_auth_user_removed: !authUserStillPresent,
        ...(storageCleanupErrors.length > 0 && { storage_warnings: storageCleanupErrors }),
      }),
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
