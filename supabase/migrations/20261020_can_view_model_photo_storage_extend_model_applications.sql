-- =============================================================================
-- Extend can_view_model_photo_storage(text) to handle 'model-applications/*'
-- so clients can resolve portfolio images mirrored from accepted applications.
--
-- Background:
--   create_model_from_accepted_application (20261018) copies application image
--   refs (supabase-storage://documentspictures/model-applications/<file>) into
--   model_photos.url + models.portfolio_images for the new/merged model
--   WITHOUT moving the underlying storage objects to model-photos/{model_id}/...
--
--   Client-side StorageImage → resolveStorageUrl → createSignedUrl POSTs to
--   /storage/v1/object/sign/documentspictures/model-applications/<file>.
--   Existing RLS for model-applications/* in this bucket only grants:
--     - object owner
--     - is_any_agency_org_member()  (documentspictures_select_scoped)
--     - caller_is_any_agency_member() (documentspictures_application_photos_read)
--   → clients get 404 ("Object not found") even though the metadata row in
--   model_photos is is_visible_to_clients=true and the model is discoverable.
--   This breaks portfolio rendering for every model whose media originated as
--   an application upload (a critical product invariant — see
--   docs/CLIENT_MODEL_PHOTO_VISIBILITY.md, system-invariants §27.1, §27.8).
--
-- Fix (IDOR-safe):
--   Extend the SECDEF helper to also accept 'model-applications/<file>' paths.
--   Client read is allowed iff:
--     - caller_is_client_org_member()
--     - has_platform_access()
--     - a model_photos row exists where url references this EXACT object and
--       is_visible_to_clients = true
--   Agency / booker / model self continue via the existing agency / owner /
--   application-pool branches in the storage policies — unchanged.
--
-- Then route the model-applications branch in documentspictures_select_scoped
-- through the helper as an additional client-allow path (kept OR'd with the
-- existing owner / is_any_agency_org_member checks for backward compat).
--
-- This is strictly additive: agency / booker / model self semantics on
-- model-photos / model-private-photos / model-applications stay identical.
-- =============================================================================

DROP POLICY IF EXISTS documentspictures_select_scoped ON storage.objects;
DROP FUNCTION IF EXISTS public.can_view_model_photo_storage(text);

CREATE FUNCTION public.can_view_model_photo_storage(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_parts       text[];
  v_prefix      text;
  v_model_uuid  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_object_name IS NULL OR length(trim(p_object_name)) = 0 THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_name, '/');
  IF v_parts IS NULL OR array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 2 THEN
    RETURN false;
  END IF;

  v_prefix := v_parts[1];

  -- ===========================================================================
  -- Branch A: model-photos / model-private-photos
  --   Path shape: '<prefix>/<model_id>/<file...>' (3+ parts)
  -- ===========================================================================
  IF v_prefix IN ('model-photos', 'model-private-photos') THEN
    IF array_length(v_parts, 1) < 3 THEN
      RETURN false;
    END IF;

    BEGIN
      v_model_uuid := v_parts[2]::uuid;
    EXCEPTION WHEN others THEN
      RETURN false;
    END;

    -- Agency org member
    IF EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = v_model_uuid AND om.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    -- Legacy booker
    IF EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = v_model_uuid AND b.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    -- Model's own user
    IF EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = v_model_uuid AND m.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    -- Clients: never the agency-only private folder
    IF v_prefix = 'model-private-photos' THEN
      RETURN false;
    END IF;

    IF NOT public.caller_is_client_org_member() THEN
      RETURN false;
    END IF;

    IF NOT public.has_platform_access() THEN
      RETURN false;
    END IF;

    -- Bind to an actual client-visible row for this exact object (IDOR-safe)
    RETURN EXISTS (
      SELECT 1
      FROM public.model_photos mp
      WHERE mp.model_id = v_model_uuid
        AND mp.is_visible_to_clients = true
        AND (
          mp.url = 'supabase-storage://documentspictures/' || p_object_name
          OR mp.url LIKE '%/documentspictures/' || p_object_name || '%'
        )
    );
  END IF;

  -- ===========================================================================
  -- Branch B: model-applications (NEW — 20261020)
  --   Path shape: 'model-applications/<file>' (2 parts; no model_id segment).
  --   Used by accepted-application mirror flow (create_model_from_accepted_
  --   application 20261018) where storage objects are NOT relocated.
  --
  --   Client read is allowed only when a client-visible model_photos row
  --   explicitly references this exact storage object — IDOR-safe and
  --   strictly tied to the same row-level visibility a client already has on
  --   public.model_photos via existing RLS (is_visible_to_clients +
  --   has_platform_access + caller_is_client_org_member).
  --
  --   Agency / booker / file owner already pass via the storage SELECT policy
  --   branches (is_any_agency_org_member / owner) — no helper call needed
  --   for those roles.
  -- ===========================================================================
  IF v_prefix = 'model-applications' THEN
    IF NOT public.caller_is_client_org_member() THEN
      RETURN false;
    END IF;

    IF NOT public.has_platform_access() THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.model_photos mp
      WHERE mp.is_visible_to_clients = true
        AND (
          mp.url = 'supabase-storage://documentspictures/' || p_object_name
          OR mp.url LIKE '%/documentspictures/' || p_object_name || '%'
        )
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_model_photo_storage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_model_photo_storage(text) TO authenticated;

COMMENT ON FUNCTION public.can_view_model_photo_storage(text) IS
  'SECURITY DEFINER helper for documentspictures SELECT. Arg: bucket-relative '
  'object path. Branches: '
  '(A) model-photos/<model_id>/<file>, model-private-photos/<model_id>/<file> — '
  'agency/booker/model-self always; clients only when model_photos row links '
  'to this exact object + is_visible_to_clients + paywall. '
  '(B) model-applications/<file> — clients only via client-visible model_photos '
  'row referencing this exact object (IDOR-safe). Agency/owner reach this '
  'prefix via separate storage policy branches. 20261020 extension.';

-- ============================================================================
-- Storage SELECT policy — route model-applications through the helper as a
-- third allow-path for clients. Owner + is_any_agency_org_member preserved.
-- ============================================================================
CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      -- model-photos / model-private-photos: full authorization via SECDEF helper
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_view_model_photo_storage(name)
      )
      OR
      -- model-applications: owner, any agency org member, or client via helper
      -- (helper enforces: client_org_member + paywall + matching model_photos row)
      (
        (storage.foldername(name))[1] = 'model-applications'
        AND (
          owner = auth.uid()
          OR public.is_any_agency_org_member()
          OR public.can_view_model_photo_storage(name)
        )
      )
      OR
      -- everything else: owner only
      (
        (storage.foldername(name))[1] NOT IN (
          'model-photos', 'model-private-photos', 'model-applications'
        )
        AND owner = auth.uid()
      )
    )
  );
