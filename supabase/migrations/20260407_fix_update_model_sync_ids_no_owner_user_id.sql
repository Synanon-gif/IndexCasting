-- =============================================================================
-- Fix: update_model_sync_ids — remove agencies.owner_user_id (column absent)
-- Date: 2026-04-07
--
-- Live DB still had legacy fallback from root migration_sync_ids_rpc_2026_04.sql;
-- 20260427 did not replace this function. Guard aligns with save_model_territories:
-- organization_members + organizations.type = 'agency' + bookers.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_model_sync_ids(
  p_model_id         uuid,
  p_mediaslide_id    text DEFAULT NULL,
  p_netwalk_model_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_model_agency_id   uuid;
  v_caller_in_agency  boolean;
  v_uid               uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT agency_id INTO v_model_agency_id
  FROM public.models
  WHERE id = p_model_id;

  IF v_model_agency_id IS NULL THEN
    RAISE EXCEPTION 'update_model_sync_ids: model not found or has no agency — model_id=%', p_model_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations org ON org.id = om.organization_id
    WHERE om.user_id = v_uid
      AND org.agency_id = v_model_agency_id
      AND org.type = 'agency'
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b
    WHERE b.agency_id = v_model_agency_id AND b.user_id = v_uid
  )
  INTO v_caller_in_agency;

  IF NOT v_caller_in_agency THEN
    RAISE EXCEPTION 'update_model_sync_ids: caller % is not a member of the agency that owns model %',
      v_uid, p_model_id;
  END IF;

  UPDATE public.models
  SET
    mediaslide_sync_id = COALESCE(p_mediaslide_id, mediaslide_sync_id),
    netwalk_model_id   = COALESCE(p_netwalk_model_id, netwalk_model_id)
  WHERE id = p_model_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_model_sync_ids(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_model_sync_ids(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.update_model_sync_ids IS
  'SECURITY DEFINER: writes revoked mediaslide_sync_id / netwalk_model_id. '
  'FIXED (20260407): org_members + type=agency + bookers; no agencies.owner_user_id.';
