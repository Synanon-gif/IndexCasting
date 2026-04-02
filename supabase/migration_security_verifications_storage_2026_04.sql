-- =============================================================================
-- Security Fixes: Verifications SELECT + Storage Policies — 2026-04
--
--   C-6b (MEDIUM): verifications table has no SELECT policy for agency members.
--         Agency bookers calling getPendingVerifications() would get an empty
--         result (blocked by RLS), with no way to review pending ID documents.
--         Fix: add a scoped SELECT policy + SECURITY DEFINER RPC.
--
--   C-2b (MEDIUM): GuestChatView resolves agency_org_id from client-supplied
--         agency_id in sessionStorage rather than from the verified guest link.
--         Fix: SECURITY DEFINER RPC get_agency_org_id_for_link() returns the
--         authoritative org_id derived from the link itself.
--
--   M-3  (MEDIUM): documentspictures SELECT storage policy allows any
--         authenticated user to create signed URLs for any file path, enabling
--         cross-agency access to private model photos if the path is known.
--         Fix: scope SELECT to agency members of the model, the model itself,
--         or clients with platform access (for discoverable photos).
--
--   M-3b (BUG): chat_files_recruiting_select uses o.name (organizations.name)
--         instead of objects.name in the path-comparison sub-query for org
--         members, making the org-member branch of the recruiting path always
--         return false.
--
-- Idempotent: CREATE OR REPLACE, DROP POLICY IF EXISTS, CREATE POLICY.
-- =============================================================================


-- =============================================================================
-- C-6b: verifications — add SELECT policy scoped to agency's own models
-- =============================================================================

DROP POLICY IF EXISTS verifications_agency_select_own ON public.verifications;

CREATE POLICY verifications_agency_select_own
  ON public.verifications FOR SELECT
  TO authenticated
  USING (
    -- Model sees own verification
    user_id = auth.uid()
    OR
    -- Agency org member sees verifications only for their own agency's models
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations  o  ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.user_id  = verifications.user_id
        AND om.user_id = auth.uid()
        AND o.type     = 'agency'
    )
  );

-- Drop the old per-user-only SELECT policy (superseded by verifications_agency_select_own)
DROP POLICY IF EXISTS "Users can read own verification" ON public.verifications;


-- =============================================================================
-- C-6c: get_pending_verifications_for_my_agency() RPC
--
-- Replaces the direct-table query in verificationSupabase.ts
-- (getPendingVerifications). Returns only pending rows belonging to the
-- caller's own agency. SECURITY DEFINER so it can join through models
-- without needing a second SELECT policy for the caller.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_verifications_for_my_agency()
RETURNS TABLE(
  id                    uuid,
  user_id               uuid,
  id_document_path      text,
  status                text,
  verified_by_agency_id uuid,
  created_at            timestamptz,
  updated_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.user_id,
    v.id_document_path,
    v.status::text,
    v.verified_by_agency_id,
    v.created_at,
    v.updated_at
  FROM public.verifications v
  JOIN public.models m ON m.user_id = v.user_id
  JOIN public.organizations o ON o.agency_id = m.agency_id
  JOIN public.organization_members om ON om.organization_id = o.id
  WHERE v.status     = 'pending'
    AND om.user_id   = auth.uid()
    AND o.type       = 'agency'
  ORDER BY v.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_pending_verifications_for_my_agency() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_verifications_for_my_agency() TO authenticated;

COMMENT ON FUNCTION public.get_pending_verifications_for_my_agency() IS
  'Returns pending verifications only for models belonging to the calling '
  'user''s agency. Prevents cross-agency verification access. '
  'C-6 fix — Security Pentest 2026-04.';


-- =============================================================================
-- C-2b: get_agency_org_id_for_link() RPC
--
-- Resolves the organization_id of the agency owning a guest link.
-- Used by GuestChatView to eliminate trust in the client-supplied agency_id
-- from sessionStorage. Only returns a result for valid, active, non-expired
-- links that have not been soft-deleted.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_agency_org_id_for_link(p_link_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
  FROM public.guest_links gl
  JOIN public.organizations o
    ON  o.agency_id = gl.agency_id
    AND o.type      = 'agency'
  WHERE gl.id         = p_link_id
    AND gl.deleted_at IS NULL
    AND gl.is_active  = true
    AND (gl.expires_at IS NULL OR gl.expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_agency_org_id_for_link(uuid) FROM PUBLIC;
-- Authenticated (guests after magic-link sign-in) AND anon (pre-auth validation)
GRANT EXECUTE ON FUNCTION public.get_agency_org_id_for_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_org_id_for_link(uuid) TO anon;

COMMENT ON FUNCTION public.get_agency_org_id_for_link(uuid) IS
  'Returns the agency organization_id for a valid guest link. '
  'Used by GuestChatView to avoid trusting client-supplied agency_id from '
  'sessionStorage. Validates that the link is active, not expired, and not '
  'soft-deleted. C-2 fix — Security Pentest 2026-04.';


-- =============================================================================
-- M-3: documentspictures — replace broad SELECT with scoped policy
--
-- The existing "Authenticated can upload 1y1ry0d_2" policy allows any
-- authenticated user to SELECT (create signed URLs for) any file in the
-- documentspictures bucket, regardless of which agency's model the photo
-- belongs to.  A booker from Agency B who knows a model_id from Agency A
-- can enumerate and access Agency A's private model photos.
--
-- Replacement policy scopes access to:
--   1. Agency members — can access photos for their own agency's models.
--   2. The model itself — can view their own photos.
--   3. Authenticated clients with platform access — only for discoverable
--      (is_visible_commercial OR is_visible_fashion) models, so they can
--      render portfolio images they are entitled to see.
--
-- Path format:  model-photos/<model_id>/<filename>
--               model-private-photos/<model_id>/<filename>
--               (other prefixes are handled by the fallback branch)
-- =============================================================================

-- Drop the broad auto-generated policy
DROP POLICY IF EXISTS "Authenticated can upload 1y1ry0d_2" ON storage.objects;

CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      -- ── model-photos: agency member, the model, or client viewing discoverable ──
      (
        (storage.foldername(name))[1] = 'model-photos'
        AND (
          -- Agency member of the model's agency
          EXISTS (
            SELECT 1
            FROM public.models m
            JOIN public.organizations o ON o.agency_id = m.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE m.id::text  = (storage.foldername(objects.name))[2]
              AND om.user_id  = auth.uid()
              AND o.type      = 'agency'
          )
          OR
          -- The model itself
          EXISTS (
            SELECT 1 FROM public.models m
            WHERE m.id::text   = (storage.foldername(objects.name))[2]
              AND m.user_id    = auth.uid()
          )
          OR
          -- Client org member viewing a discoverable model
          (
            EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.type     = 'client'
            )
            AND EXISTS (
              SELECT 1 FROM public.models m
              WHERE m.id::text = (storage.foldername(objects.name))[2]
                AND (m.is_visible_commercial = true OR m.is_visible_fashion = true)
            )
          )
        )
      )
      OR
      -- ── model-private-photos: agency member or the model only ─────────────────
      (
        (storage.foldername(name))[1] = 'model-private-photos'
        AND (
          EXISTS (
            SELECT 1
            FROM public.models m
            JOIN public.organizations o ON o.agency_id = m.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE m.id::text  = (storage.foldername(objects.name))[2]
              AND om.user_id  = auth.uid()
              AND o.type      = 'agency'
          )
          OR
          EXISTS (
            SELECT 1 FROM public.models m
            WHERE m.id::text = (storage.foldername(objects.name))[2]
              AND m.user_id  = auth.uid()
          )
        )
      )
      OR
      -- ── other paths (e.g. temp uploads, legacy): owner-only access ────────────
      (
        (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos')
        AND owner = auth.uid()
      )
    )
  );

-- Similarly tighten INSERT: agency members may only upload to their own models' paths
DROP POLICY IF EXISTS "Authenticated can upload 1y1ry0d_0" ON storage.objects;

CREATE POLICY documentspictures_insert_own_model
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documentspictures'
    AND (
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND EXISTS (
          SELECT 1
          FROM public.models m
          JOIN public.organizations o ON o.agency_id = m.agency_id
          JOIN public.organization_members om ON om.organization_id = o.id
          WHERE m.id::text = (storage.foldername(objects.name))[2]
            AND om.user_id = auth.uid()
            AND o.type     = 'agency'
        )
      )
      -- Models can also upload to their own profile folder
      OR EXISTS (
        SELECT 1 FROM public.models m
        WHERE m.id::text = (storage.foldername(objects.name))[2]
          AND m.user_id  = auth.uid()
      )
    )
  );

-- UPDATE / DELETE: keep existing broad policies for now (agency-scoped via INSERT)
-- The broad update/delete policies are named:
--   "Authenticated can upload 1y1ry0d_1" (UPDATE)
--   "Authenticated can upload 1y1ry0d_3" (DELETE)
-- Replace them with scoped equivalents:
DROP POLICY IF EXISTS "Authenticated can upload 1y1ry0d_1" ON storage.objects;

CREATE POLICY documentspictures_update_own_model
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      owner = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.models m
        JOIN public.organizations o ON o.agency_id = m.agency_id
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE m.id::text = (storage.foldername(objects.name))[2]
          AND om.user_id = auth.uid()
          AND o.type     = 'agency'
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated can upload 1y1ry0d_3" ON storage.objects;

CREATE POLICY documentspictures_delete_own_model
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      owner = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.models m
        JOIN public.organizations o ON o.agency_id = m.agency_id
        JOIN public.organization_members om ON om.organization_id = o.id
        WHERE m.id::text = (storage.foldername(objects.name))[2]
          AND om.user_id = auth.uid()
          AND o.type     = 'agency'
      )
    )
  );


-- =============================================================================
-- M-3b: Fix bug in chat_files_recruiting_select — o.name vs objects.name
--
-- The existing policy used (storage.foldername(o.name))[2] where o is the
-- organizations table alias.  organizations.name is a display-name string,
-- not a file path; this sub-query always returns false for org members,
-- meaning only applicants (not org members) could access recruiting files.
-- =============================================================================

DROP POLICY IF EXISTS chat_files_recruiting_select ON storage.objects;

CREATE POLICY chat_files_recruiting_select
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    (bucket_id = 'chat-files')
    AND (
      -- Owner always has access
      (owner = auth.uid())
      OR
      -- /chat/<conversation_id>/... — participant access
      (
        (storage.foldername(name))[1] = 'chat'
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.id::text = (storage.foldername(objects.name))[2]
            AND (auth.uid())::text = ANY(c.participant_ids::text[])
        )
      )
      OR
      -- /recruiting/<thread_id>/... — org member OR applicant access
      (
        (storage.foldername(name))[1] = 'recruiting'
        AND (
          -- Org member (fixed: use objects.name not o.name)
          EXISTS (
            SELECT 1
            FROM public.recruiting_chat_threads rt
            JOIN public.organizations o ON o.agency_id = rt.agency_id
            JOIN public.organization_members om ON om.organization_id = o.id
            WHERE rt.id::text  = (storage.foldername(objects.name))[2]
              AND om.user_id   = auth.uid()
          )
          OR
          -- Applicant
          EXISTS (
            SELECT 1
            FROM public.recruiting_chat_threads rt
            JOIN public.model_applications app ON app.id = rt.application_id
            WHERE rt.id::text          = (storage.foldername(objects.name))[2]
              AND app.applicant_user_id = auth.uid()
          )
        )
      )
      OR
      -- /options/<option_request_id>/... — option request participant access
      (
        (storage.foldername(name))[1] = 'options'
        AND EXISTS (
          SELECT 1 FROM public.option_requests orq
          WHERE orq.id::text = (storage.foldername(objects.name))[2]
            AND public.option_request_visible_to_me(orq.id)
        )
      )
    )
  );


-- =============================================================================
-- Verification queries
-- =============================================================================

-- C-6b: new verifications SELECT policies present?
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'verifications' AND schemaname = 'public'
ORDER BY cmd, policyname;

-- C-2b: get_agency_org_id_for_link function exists?
SELECT proname FROM pg_proc
WHERE proname = 'get_agency_org_id_for_link'
  AND pronamespace = 'public'::regnamespace;

-- M-3: old broad policies removed?
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'Authenticated can upload 1y1ry0d%';
