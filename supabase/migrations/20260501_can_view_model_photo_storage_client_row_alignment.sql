-- =============================================================================
-- Client model photo storage alignment (Invite + Photo incident B)
-- Date: 2026-05-01
--
-- Problem: model_photos RLS lets clients SELECT rows with is_visible_to_clients
--   + has_platform_access() + caller_is_client_org_member(), but
--   can_view_model_photo_storage(model_id) gated clients on models.is_visible_* only.
--   Result: metadata visible, createSignedUrl denied → grey tiles.
--
-- Fix: can_view_model_photo_storage takes the full storage object path (bucket-relative
--   `name`). Agency/booker/model-self unchanged. Clients may read model-photos/* only
--   when a model_photos row exists for that exact object, is_visible_to_clients,
--   has_platform_access(), and caller_is_client_org_member().
-- model-private-photos/* remains non-client (same as product: private uploads).
--
-- NOT touched: get_my_org_context, admin RPCs, can_view_model_photo(uuid) (edge/watermark).
-- =============================================================================

-- PG forbids renaming the only argument via CREATE OR REPLACE (old name was model_id_text).
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
  IF v_parts IS NULL OR array_length(v_parts, 1) IS NULL OR array_length(v_parts, 1) < 3 THEN
    RETURN false;
  END IF;

  v_prefix := v_parts[1];
  IF v_prefix NOT IN ('model-photos', 'model-private-photos') THEN
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

  -- Clients: never agency-only private folder in this bucket
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
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_model_photo_storage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_model_photo_storage(text) TO authenticated;

COMMENT ON FUNCTION public.can_view_model_photo_storage(text) IS
  'SECURITY DEFINER helper for documentspictures SELECT. Arg: bucket-relative object path '
  '(e.g. model-photos/{model_id}/file.jpg). Agency/booker/model-self: folder + model id. '
  'Client: model-photos only + model_photos row for same path + is_visible_to_clients + '
  'has_platform_access + caller_is_client_org_member. 20260501 alignment with model_photos RLS.';

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
        (storage.foldername(name))[1] NOT IN ('model-photos', 'model-private-photos')
        AND owner = auth.uid()
      )
    )
  );
