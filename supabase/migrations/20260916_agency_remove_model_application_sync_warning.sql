-- =============================================================================
-- 20260916: agency_remove_model — RAISE WARNING when MAT removed but no app row
--         updated (debug drift: missing applicant_user_id on models, etc.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agency_remove_model(p_model_id uuid, p_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $function$
DECLARE
  can_act       boolean;
  v_deleted     int;
  v_remaining   int;
  v_next_agency uuid;
  v_app_sync    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
  ) OR EXISTS (
    SELECT 1 FROM public.bookers b WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
  ) INTO can_act;

  IF NOT can_act THEN
    RAISE EXCEPTION 'Not authorized for this agency';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.models WHERE id = p_model_id) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.model_agency_territories
    WHERE model_id = p_model_id AND agency_id = p_agency_id
  ) THEN
    UPDATE public.model_applications app
    SET status = 'representation_ended'::public.application_status,
        updated_at = now()
    FROM public.models m
    WHERE m.id = p_model_id
      AND m.user_id IS NOT NULL
      AND app.applicant_user_id = m.user_id
      AND app.accepted_by_agency_id = p_agency_id
      AND app.status IN ('accepted', 'pending_model_confirmation');
    GET DIAGNOSTICS v_app_sync = ROW_COUNT;
    IF v_app_sync = 0 THEN
      RAISE LOG 'agency_remove_model: idempotent no_mat path updated 0 application rows for model % agency %',
        p_model_id, p_agency_id;
    END IF;
    RETURN true;
  END IF;

  DELETE FROM public.model_agency_territories
  WHERE model_id = p_model_id AND agency_id = p_agency_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted < 1 THEN
    RETURN false;
  END IF;

  SELECT count(*)::int INTO v_remaining
  FROM public.model_agency_territories
  WHERE model_id = p_model_id;

  IF v_remaining > 0 THEN
    SELECT mat.agency_id INTO v_next_agency
    FROM public.model_agency_territories mat
    WHERE mat.model_id = p_model_id
    ORDER BY mat.agency_id ASC
    LIMIT 1;

    UPDATE public.models SET
      agency_id = v_next_agency,
      agency_relationship_status = 'active',
      agency_relationship_ended_at = NULL,
      updated_at = now()
    WHERE id = p_model_id;
  ELSE
    UPDATE public.models SET
      agency_relationship_status = 'ended',
      agency_relationship_ended_at = now(),
      is_visible_commercial = false,
      is_visible_fashion = false,
      agency_id = NULL,
      updated_at = now()
    WHERE id = p_model_id;
  END IF;

  UPDATE public.model_applications app
  SET status = 'representation_ended'::public.application_status,
      updated_at = now()
  FROM public.models m
  WHERE m.id = p_model_id
    AND m.user_id IS NOT NULL
    AND app.applicant_user_id = m.user_id
    AND app.accepted_by_agency_id = p_agency_id
    AND app.status IN ('accepted', 'pending_model_confirmation');

  GET DIAGNOSTICS v_app_sync = ROW_COUNT;
  IF v_deleted >= 1 AND v_app_sync = 0 THEN
    RAISE WARNING
      'agency_remove_model: MAT removed for model % agency % but 0 application rows updated (check applicant_user_id / application pairing)',
      p_model_id, p_agency_id;
  END IF;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.agency_remove_model(uuid, uuid) IS
  'Removes MAT for (model, agency); updates models row; sets model_applications to representation_ended. '
  'Raises WARNING if MAT delete succeeded but no application row matched. 20260916.';

REVOKE ALL ON FUNCTION public.agency_remove_model(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_remove_model(uuid, uuid) TO authenticated;
