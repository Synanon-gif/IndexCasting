-- =============================================================================
-- 20260613_application_photo_agency_read_policy.sql
--
-- BUG A FIX: Model application photos (model-applications/ folder in the
-- documentspictures bucket) are inaccessible to agency recruiting viewers.
--
-- ROOT CAUSE:
--   The documentspictures_select_scoped policy (20260406_fix_storage_policies_secdef.sql)
--   has the following fallback branch for all paths that are NOT model-photos/
--   or model-private-photos/:
--
--       (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos')
--       AND owner = auth.uid()
--
--   model-applications/ falls into this fallback. Since the MODEL user uploaded
--   the file (owner = model.user_id), agency members calling createSignedUrl()
--   are not the owner → Supabase returns HTTP 400 "Object not found" (storage
--   disguises permission denials as not-found for security).
--
-- FIX:
--   1. Add SECURITY DEFINER helper is_any_agency_org_member() — returns true
--      for any authenticated agency organisation member (org_members + legacy bookers).
--      row_security=off; explicit auth + membership guards (no models JOIN = no
--      RLS recursion risk).
--
--   2. Recreate documentspictures_select_scoped to explicitly handle
--      model-applications/:
--        - the file owner (the model who uploaded) can always see their own file
--        - any authenticated agency org member can see all application photos
--          for recruiting (consistent with model_applications SELECT RLS which
--          already grants all agency members global read access).
--
--   The INSERT policy is unchanged: models upload their own files (owner =
--   auth.uid() branch), and that remains the only write path.
--
-- SECURITY INVARIANTS:
--   - model-photos / model-private-photos: unchanged, gated by can_view_model_photo_storage()
--   - model-applications:
--       read: owner (uploading model) OR any agency org member / legacy booker
--       write: unchanged (owner only, i.e. the uploading model)
--   - all other paths: unchanged (owner only)
--   - No FOR ALL policy risk (helpers are STABLE functions without RLS-recursive JOINs)
-- =============================================================================


-- ─── 1. Helper: is_any_agency_org_member ─────────────────────────────────────
-- Returns TRUE if the authenticated caller belongs to ANY agency-type
-- organisation (via organization_members) OR is a legacy booker.
-- Used by the storage SELECT policy for model-applications/ access.

DROP FUNCTION IF EXISTS public.is_any_agency_org_member();

CREATE OR REPLACE FUNCTION public.is_any_agency_org_member()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  -- GUARD 2: org member of any agency-type org  OR legacy booker
  RETURN (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.type = 'agency'
    )
    OR EXISTS (
      SELECT 1
      FROM public.bookers b
      WHERE b.user_id = auth.uid()
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_any_agency_org_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_any_agency_org_member() TO authenticated;

COMMENT ON FUNCTION public.is_any_agency_org_member IS
  'SECURITY DEFINER helper for storage.objects policies. '
  'Returns true if the caller is an agency org member or legacy booker. '
  'row_security=off with explicit guards. '
  'Created 20260613 to fix model-applications/ read access for agency recruiting.';


-- ─── 2. Recreate documentspictures_select_scoped ─────────────────────────────
-- Rebuilds the SELECT policy to explicitly handle model-applications/.

DROP POLICY IF EXISTS documentspictures_select_scoped ON storage.objects;

CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      -- model-photos / model-private-photos: SECURITY DEFINER helper
      -- (agency, booker, model-self, discoverable client)
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_view_model_photo_storage((storage.foldername(name))[2])
      )
      OR
      -- model-applications/: the uploading model (owner) OR any agency member
      -- (agencies need to see recruiting photos; consistent with SELECT RLS on
      --  model_applications which already grants all agency members global read)
      (
        (storage.foldername(name))[1] = 'model-applications'
        AND (
          owner = auth.uid()
          OR public.is_any_agency_org_member()
        )
      )
      OR
      -- All other paths (verifications, temp, legacy): owner-only
      (
        (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos', 'model-applications')
        AND owner = auth.uid()
      )
    )
  );


-- ─── 3. Harden RPC: create_model_from_accepted_application ───────────────────
-- Add the mandatory SET row_security TO off (security rule 21).
-- Also adds explicit auth.uid() IS NULL guard (GUARD 1).
-- Logic is otherwise unchanged from migration_create_model_from_application_rpc.sql.

CREATE OR REPLACE FUNCTION public.create_model_from_accepted_application(
  p_application_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_app            RECORD;
  v_existing_id    UUID;
  v_model_id       UUID;
  v_name           TEXT;
  v_imgs           TEXT[];
BEGIN
  -- GUARD 1: authenticated (mandatory per security rule 21)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Fetch and validate the application
  SELECT *
    INTO v_app
    FROM public.model_applications
   WHERE id = p_application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found: %', p_application_id;
  END IF;

  -- GUARD 2 + 3: caller is the applicant OR a member of the accepting agency
  IF v_app.applicant_user_id IS NOT NULL AND v_app.applicant_user_id <> auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
       WHERE o.agency_id = v_app.accepted_by_agency_id
         AND o.type = 'agency'
         AND om.user_id = auth.uid()
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers b
       WHERE b.agency_id = v_app.accepted_by_agency_id
         AND b.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'access_denied: caller is not the applicant or an agency member';
    END IF;
  END IF;

  IF v_app.status <> 'accepted' OR v_app.accepted_by_agency_id IS NULL THEN
    RAISE EXCEPTION 'application_not_accepted_or_missing_agency: %', p_application_id;
  END IF;

  -- Idempotency: if the applicant already has a linked model row, return existing id
  IF v_app.applicant_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM public.models
     WHERE user_id = v_app.applicant_user_id
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Build display name
  v_name := trim(coalesce(v_app.first_name, '') || ' ' || coalesce(v_app.last_name, ''));
  IF v_name = '' THEN v_name := 'Model'; END IF;

  -- Extract portfolio images from application JSONB
  -- Keys: profile, fullBody, closeUp — stored as supabase-storage:// URIs
  v_imgs := ARRAY(
    SELECT val::text
      FROM jsonb_each_text(coalesce(v_app.images, '{}'::jsonb)) AS t(key, val)
     WHERE key IN ('profile', 'fullBody', 'closeUp')
       AND val IS NOT NULL
       AND val <> ''
  );

  -- Insert model row (SECURITY DEFINER + row_security=off bypasses agency-member INSERT RLS)
  INSERT INTO public.models (
    agency_id,
    user_id,
    agency_relationship_status,
    agency_relationship_ended_at,
    name,
    height,
    city,
    country_code,
    hair_color,
    sex,
    portfolio_images,
    polaroids,
    is_visible_commercial,
    is_visible_fashion
  ) VALUES (
    v_app.accepted_by_agency_id,
    v_app.applicant_user_id,
    'active',
    NULL,
    v_name,
    coalesce(v_app.height, 0),
    v_app.city,
    v_app.country_code,
    v_app.hair_color,
    CASE
      WHEN v_app.gender IN ('female', 'male') THEN v_app.gender::text
      ELSE NULL
    END,
    coalesce(v_imgs, ARRAY[]::text[]),
    ARRAY[]::text[],
    false,
    true
  )
  RETURNING id INTO v_model_id;

  -- Mirror application images to model_photos (supabase-storage:// URIs preserved)
  IF array_length(v_imgs, 1) > 0 THEN
    INSERT INTO public.model_photos (
      model_id, url, sort_order, visible, is_visible_to_clients,
      photo_type, source, api_external_id
    )
    SELECT
      v_model_id,
      img,
      ord::integer,
      true,
      true,
      'portfolio',
      'application',
      NULL
    FROM unnest(v_imgs) WITH ORDINALITY AS t(img, ord)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_model_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_model_from_accepted_application(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_model_from_accepted_application(UUID) TO authenticated;

COMMENT ON FUNCTION public.create_model_from_accepted_application IS
  'SECURITY DEFINER RPC: creates a models row from an accepted application. '
  'row_security=off with explicit auth + caller guards. '
  'Idempotent: returns existing model_id if applicant already has a linked model. '
  'Updated 20260613: added SET row_security TO off, hardened guards per security rule 21.';


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 1. Helper function exists and is SECURITY DEFINER
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_any_agency_org_member'
      AND p.prosecdef = true
  ), 'is_any_agency_org_member must be SECURITY DEFINER';

  -- 2. SELECT policy was recreated
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'documentspictures_select_scoped'
  ), 'documentspictures_select_scoped must exist';

  -- 3. RPC exists with row_security=off
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_model_from_accepted_application'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'create_model_from_accepted_application must be SECURITY DEFINER with row_security=off';

  RAISE NOTICE 'PASS: 20260613 — application photo agency read + RPC hardening verified';
END $$;
