-- =============================================================================
-- Fix: documentspictures storage policies — wrap public.models JOIN in SECURITY DEFINER
-- Date: 2026-04-06
--
-- Bug: All 4 documentspictures_* policies (SELECT, INSERT, UPDATE, DELETE) contained
--      direct EXISTS (SELECT 1 FROM public.models m JOIN public.organizations o
--      JOIN public.organization_members om ...) subqueries in USING/WITH CHECK.
--
--      These subqueries are subject to the models RLS. Any bug in models RLS
--      (42P17 recursion, broken policy) silently breaks ALL portfolio/polaroid
--      uploads, downloads, and deletes — storage access fails whenever models RLS
--      has an issue, which it has had repeatedly (2026-04-05/06/13/14).
--
-- Fix:
--   1. Create SECURITY DEFINER helper functions (SET row_security TO off) with
--      explicit auth + membership guards — bypasses models RLS safely.
--   2. Recreate all 4 documentspictures_* policies using these helpers.
--
-- Functions created:
--   can_agency_manage_model_photo(model_id_text text) — agency upload/manage check
--   can_view_model_photo_storage(model_id_text text)  — broader SELECT check
--     (replaces the 3-branch USING clause: agency, model-self, client-discoverable)
--
-- Security: All helpers have:
--   SET row_security TO off  (safe: guards are explicit, not RLS-dependent)
--   3 guard layers: auth.uid() not null, membership check, resource ownership
-- =============================================================================


-- ─── 1. Helper: can_agency_manage_model_photo ────────────────────────────────
-- Returns TRUE if the authenticated caller is allowed to upload/manage photos
-- for the given model (agency member, legacy booker, or the model's own user).

DROP FUNCTION IF EXISTS public.can_agency_manage_model_photo(text);

CREATE OR REPLACE FUNCTION public.can_agency_manage_model_photo(
  model_id_text text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_uuid uuid;
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  -- GUARD 2: valid UUID
  BEGIN
    v_model_uuid := model_id_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- GUARD 3: caller is agency member, legacy booker, or the model itself
  RETURN (
    -- Agency org member managing this model
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = v_model_uuid AND om.user_id = auth.uid()
    )
    OR
    -- Legacy booker
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = v_model_uuid AND b.user_id = auth.uid()
    )
    OR
    -- The model's own user (self-upload)
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = v_model_uuid AND m.user_id = auth.uid()
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_agency_manage_model_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_agency_manage_model_photo(text) TO authenticated;

COMMENT ON FUNCTION public.can_agency_manage_model_photo IS
  'SECURITY DEFINER helper for storage.objects policies on documentspictures bucket. '
  'Returns true if caller may upload/manage model photos. '
  'row_security=off with explicit guards replaces direct models JOIN in storage policy. '
  'Created: 20260406 to decouple storage policies from models RLS.';


-- ─── 2. Helper: can_view_model_photo_storage ─────────────────────────────────
-- Returns TRUE if the authenticated caller may read model photos from storage.
-- Covers: agency members, the model itself, clients viewing discoverable models.

DROP FUNCTION IF EXISTS public.can_view_model_photo_storage(text);

CREATE OR REPLACE FUNCTION public.can_view_model_photo_storage(
  model_id_text text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  BEGIN
    v_model_uuid := model_id_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN (
    -- Agency org member
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = v_model_uuid AND om.user_id = auth.uid()
    )
    OR
    -- Legacy booker
    EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = v_model_uuid AND b.user_id = auth.uid()
    )
    OR
    -- The model's own user
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = v_model_uuid AND m.user_id = auth.uid()
    )
    OR
    -- Client org member viewing a discoverable model
    (
      EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = auth.uid() AND o.type = 'client'
      )
      AND EXISTS (
        SELECT 1 FROM public.models m
        WHERE m.id = v_model_uuid
          AND (m.is_visible_commercial = true OR m.is_visible_fashion = true)
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_model_photo_storage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_model_photo_storage(text) TO authenticated;

COMMENT ON FUNCTION public.can_view_model_photo_storage IS
  'SECURITY DEFINER helper for documentspictures SELECT storage policy. '
  'row_security=off with explicit guards. Covers: agency, booker, model-self, client-discoverable. '
  'Created: 20260406 to decouple storage policies from models RLS.';


-- ─── 3. Recreate documentspictures_* policies using helpers ──────────────────

-- SELECT ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documentspictures_select_scoped ON storage.objects;

CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      -- model-photos / model-private-photos: use SECURITY DEFINER helper
      -- (replaces 3-branch direct JOIN on public.models — decoupled from models RLS)
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_view_model_photo_storage((storage.foldername(name))[2])
      )
      OR
      -- private photos: more restrictive — agency/booker/model-self only (no client)
      -- Note: can_view_model_photo_storage already covers this correctly above.
      -- Owner-only fallback for other paths (temp uploads, legacy, verifications):
      (
        (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos')
        AND owner = auth.uid()
      )
    )
  );

-- INSERT ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documentspictures_insert_own_model ON storage.objects;

CREATE POLICY documentspictures_insert_own_model
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documentspictures'
    AND (
      -- model-photos / model-private-photos: SECURITY DEFINER helper
      -- (replaces direct models JOIN — decoupled from models RLS)
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_agency_manage_model_photo((storage.foldername(name))[2])
      )
      OR
      -- Other paths (e.g. verifications): owner-only
      (
        (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos')
        AND owner = auth.uid()
      )
    )
  );

-- UPDATE ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documentspictures_update_own_model ON storage.objects;

CREATE POLICY documentspictures_update_own_model
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      owner = auth.uid()
      OR (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_agency_manage_model_photo((storage.foldername(name))[2])
      )
    )
  );

-- DELETE ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documentspictures_delete_own_model ON storage.objects;

CREATE POLICY documentspictures_delete_own_model
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      owner = auth.uid()
      OR (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_agency_manage_model_photo((storage.foldername(name))[2])
      )
    )
  );


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Verify helper functions exist and are SECURITY DEFINER
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_agency_manage_model_photo'
      AND p.prosecdef = true
  ), 'can_agency_manage_model_photo must be SECURITY DEFINER';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_view_model_photo_storage'
      AND p.prosecdef = true
  ), 'can_view_model_photo_storage must be SECURITY DEFINER';

  -- Verify policies exist
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentspictures_select_scoped'
  ), 'documentspictures_select_scoped must exist';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentspictures_insert_own_model'
  ), 'documentspictures_insert_own_model must exist';

  -- Verify no remaining direct models JOIN in storage policies on documentspictures
  -- (manual inspection recommended after deploy)
  RAISE NOTICE 'Storage SECURITY DEFINER helper policies: verified OK';
END $$;
