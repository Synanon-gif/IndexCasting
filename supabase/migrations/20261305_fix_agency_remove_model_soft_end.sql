-- =============================================================================
-- 20261305: agency_remove_model — soft-end only; NEVER set models.agency_id NULL
--
-- Root cause: 20260916 still nulled agency_id when the last MAT row was removed,
-- but live schema enforces models.agency_id NOT NULL (23502 via PostgREST).
-- migration_model_roster_soft_delete.sql was never under supabase/migrations/.
-- =============================================================================

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS agency_relationship_status text DEFAULT 'active';

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS agency_relationship_ended_at timestamptz;

ALTER TABLE public.models
  DROP CONSTRAINT IF EXISTS models_agency_relationship_status_check;

ALTER TABLE public.models
  ADD CONSTRAINT models_agency_relationship_status_check
  CHECK (
    agency_relationship_status IS NULL
    OR agency_relationship_status IN ('active', 'pending_link', 'ended')
  );

COMMENT ON COLUMN public.models.agency_relationship_status IS
  'active = roster; pending_link = invite outstanding; ended = soft-removed, history kept; models.agency_id stays set.';

COMMENT ON COLUMN public.models.agency_relationship_ended_at IS
  'When the agency ended representation (soft delete).';

-- ─── agency_remove_model — MAT-first, multi-agency-safe, agency_id immutable ───

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
  v_app_sync    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Owner/Booker on agency org OR legacy bookers row (no email matching).
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND o.type = 'agency'
      AND o.agency_id = p_agency_id
      AND om.role::text IN ('owner', 'booker')
  )
  OR EXISTS (
    SELECT 1 FROM public.bookers b
    WHERE b.user_id = auth.uid() AND b.agency_id = p_agency_id
  )
  INTO can_act;

  IF NOT can_act THEN
    RAISE EXCEPTION 'Not authorized for this agency';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.models WHERE id = p_model_id) THEN
    RETURN false;
  END IF;

  -- Idempotent: MAT already absent for this pair (applications still synced).
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
      RAISE LOG
        'agency_remove_model: idempotent no_mat path updated 0 application rows for model % agency %',
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

  -- Last representation row removed globally: soft-end visibility + relationship flags.
  -- models.agency_id remains the historical ownership context (NOT NULL invariant).
  IF v_remaining = 0 THEN
    UPDATE public.models SET
      agency_relationship_status = 'ended',
      agency_relationship_ended_at = now(),
      is_visible_commercial = false,
      is_visible_fashion = false,
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
  'Removes MAT for (model, agency). When no MAT rows remain, soft-ends representation '
  '(status/visibility) without clearing models.agency_id. Syncs recruiting applications '
  'to representation_ended. 20261305 — no agency_id NULL.';

REVOKE ALL ON FUNCTION public.agency_remove_model(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_remove_model(uuid, uuid) TO authenticated;
