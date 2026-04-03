-- Migration: update_model_sync_ids RPC
--
-- HINTERGRUND:
--   migration_security_hardening_2026_04.sql macht
--     REVOKE UPDATE (mediaslide_sync_id, netwalk_model_id, mediaslide_model_id) ON models FROM authenticated
--   Damit können die Sync-Services diese Felder nicht mehr über normale Client-Updates schreiben.
--
-- LÖSUNG:
--   SECURITY DEFINER RPC, die nur von authentifizierten Booker/Agency-Usern aufgerufen werden darf
--   (geprüft über organization_members) und die Sync-IDs auf dem übergebenen Model setzt.
--   Die Funktion validiert, dass der aufrufende User zur Agency des Models gehört.

-- ─── RPC: update_model_sync_ids ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_model_sync_ids(
  p_model_id         uuid,
  p_mediaslide_id    text DEFAULT NULL,
  p_netwalk_model_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_agency_id uuid;
  v_caller_in_agency boolean;
BEGIN
  -- Resolve the model's agency so we can verify the caller belongs to it.
  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'update_model_sync_ids: model not found or has no agency — model_id=%', p_model_id;
  END IF;

  -- Verify that the authenticated caller is a member of that agency's organisation
  -- (or is the agency owner stored in agencies.owner_user_id).
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND org.agency_id = v_model_agency_id
  ) INTO v_caller_in_agency;

  IF NOT v_caller_in_agency THEN
    -- Also accept the agency owner who may not be in organization_members
    SELECT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = v_model_agency_id AND owner_user_id = auth.uid()
    ) INTO v_caller_in_agency;
  END IF;

  IF NOT v_caller_in_agency THEN
    RAISE EXCEPTION 'update_model_sync_ids: caller % is not a member of the agency that owns model %',
      auth.uid(), p_model_id;
  END IF;

  -- Perform the privileged column update.
  UPDATE public.models
  SET
    mediaslide_sync_id  = COALESCE(p_mediaslide_id,    mediaslide_sync_id),
    netwalk_model_id    = COALESCE(p_netwalk_model_id,  netwalk_model_id)
  WHERE id = p_model_id;
END;
$$;

-- Only authenticated users may call this function; public/anon access is rejected.
REVOKE ALL ON FUNCTION public.update_model_sync_ids(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_model_sync_ids(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.update_model_sync_ids IS
  'SECURITY DEFINER wrapper that allows agency members to write the otherwise-revoked '
  'mediaslide_sync_id / netwalk_model_id columns. Validates caller membership in the model''s agency.';
