-- =============================================================================
-- Agency (and booker) read for documentspictures/model-applications/* when the
-- object is referenced from model_photos (mirrored accepted-application paths).
--
-- Problem:
--   Branch B in can_view_model_photo_storage (20261020) only allowed *clients*
--   on model-applications/*. Agency was assumed to pass via
--   documentspictures_select_scoped OR is_any_agency_org_member(), but
--   is_any_agency_org_member() is not defined in repo migrations and may drift
--   or diverge from caller_is_any_agency_member() (20260812: agency org +
--   legacy bookers + admin). Agencies then got no matching allow path for
--   signed URLs on mirrored application paths.
--
-- Fix:
--   1) In model-applications branch: before client checks, allow admin;
--      owning agency org member; legacy booker — bound to a model_photos row
--      referencing this exact object (IDOR-safe, same binding idea as clients).
--   2) documentspictures_select_scoped: use caller_is_any_agency_member()
--      instead of is_any_agency_org_member() for the global agency pool branch.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_view_model_photo_storage(
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

  IF v_prefix IN ('model-photos', 'model-private-photos') THEN
    IF array_length(v_parts, 1) < 3 THEN
      RETURN false;
    END IF;

    BEGIN
      v_model_uuid := v_parts[2]::uuid;
    EXCEPTION WHEN others THEN
      RETURN false;
    END;

    IF EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = v_model_uuid AND om.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.models m
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE m.id = v_model_uuid AND b.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = v_model_uuid AND m.user_id = auth.uid()
    ) THEN
      RETURN true;
    END IF;

    IF v_prefix = 'model-private-photos' THEN
      RETURN false;
    END IF;

    IF NOT public.caller_is_client_org_member() THEN
      RETURN false;
    END IF;

    IF NOT public.has_platform_access() THEN
      RETURN false;
    END IF;

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

  IF v_prefix = 'model-applications' THEN
    IF public.is_current_user_admin() THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.model_photos mp
      JOIN public.models m ON m.id = mp.model_id
      JOIN public.organizations o ON o.agency_id = m.agency_id AND o.type = 'agency'
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = auth.uid()
        AND m.agency_id IS NOT NULL
        AND (
          mp.url = 'supabase-storage://documentspictures/' || p_object_name
          OR mp.url LIKE '%/documentspictures/' || p_object_name || '%'
        )
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.model_photos mp
      JOIN public.models m ON m.id = mp.model_id
      JOIN public.bookers b ON b.agency_id = m.agency_id
      WHERE b.user_id = auth.uid()
        AND m.agency_id IS NOT NULL
        AND (
          mp.url = 'supabase-storage://documentspictures/' || p_object_name
          OR mp.url LIKE '%/documentspictures/' || p_object_name || '%'
        )
    ) THEN
      RETURN true;
    END IF;

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
  'object path. model-photos/model-private-photos: agency/booker/model-self; '
  'clients only with visible model_photos row + paywall. model-applications: '
  'admin; owning agency/booker via model_photos URL match; clients with visible '
  'row + paywall. 20261028: agency bound path for mirrored application URLs.';

DROP POLICY IF EXISTS documentspictures_select_scoped ON storage.objects;

CREATE POLICY documentspictures_select_scoped
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documentspictures'
    AND (
      (
        (storage.foldername(name))[1] IN ('model-photos', 'model-private-photos')
        AND public.can_view_model_photo_storage(name)
      )
      OR
      (
        (storage.foldername(name))[1] = 'model-applications'
        AND (
          owner = auth.uid()
          OR public.caller_is_any_agency_member()
          OR public.can_view_model_photo_storage(name)
        )
      )
      OR
      (
        (storage.foldername(name))[1] NOT IN (
          'model-photos', 'model-private-photos', 'model-applications'
        )
        AND owner = auth.uid()
      )
    )
  );
