-- =============================================================================
-- 20260905_b: End representation — sync model_applications + re-apply uniqueness
-- Requires: 20260905_a_application_status_representation_ended.sql (enum value).
-- =============================================================================

-- ─── 1) Partial unique index: treat representation_ended like rejected ─────
DROP INDEX IF EXISTS public.uidx_model_applications_active_per_agency;

CREATE UNIQUE INDEX uidx_model_applications_active_per_agency
  ON public.model_applications (applicant_user_id, agency_id)
  WHERE status NOT IN ('rejected', 'representation_ended');

COMMENT ON INDEX public.uidx_model_applications_active_per_agency IS
  '20260905: One active application per (applicant, target agency); rejected and '
  'representation_ended rows do not block re-application.';

-- ─── 2) Applicant DELETE — allow clearing representation_ended rows ─────────
DROP POLICY IF EXISTS "Applicants delete own pending or rejected applications"
  ON public.model_applications;

CREATE POLICY "Applicants delete own pending or rejected applications"
  ON public.model_applications FOR DELETE
  TO authenticated
  USING (
    applicant_user_id = auth.uid()
    AND status IN ('pending', 'rejected', 'representation_ended')
  );

-- ─── 3) agency_remove_model — mark recruiting applications for this pair ───
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

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.agency_remove_model(uuid, uuid) IS
  'Removes all MAT for (model, agency); updates models row; sets model_applications '
  'for this acceptance to representation_ended. Idempotent: no MAT → still syncs '
  'application rows. 20260905_b.';

REVOKE ALL ON FUNCTION public.agency_remove_model(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_remove_model(uuid, uuid) TO authenticated;
