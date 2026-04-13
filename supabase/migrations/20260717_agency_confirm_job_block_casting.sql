-- =============================================================================
-- 20260717: agency_confirm_job_agency_only — block castings + remove inline system message
-- 1) Castings cannot become jobs (system invariant). Adds request_type guard.
-- 2) System message emission moved to the store (parity with clientConfirmJobStore).
--    The RPC no longer calls insert_option_request_system_message — the store does.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agency_confirm_job_agency_only(
  p_request_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_id uuid;
  v_req record;
  v_has_membership boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_req
  FROM public.option_requests
  WHERE id = p_request_id;

  IF v_req IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF NOT v_req.is_agency_only THEN
    RAISE EXCEPTION 'not_agency_only_flow';
  END IF;

  IF COALESCE(v_req.request_type::text, 'option') IS DISTINCT FROM 'option' THEN
    RAISE EXCEPTION 'castings_cannot_become_jobs';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_caller_id
      AND o.agency_id = v_req.agency_id::uuid
      AND o.type = 'agency'
    UNION ALL
    SELECT 1
    FROM public.bookers
    WHERE agency_id = v_req.agency_id AND user_id = v_caller_id
  ) INTO v_has_membership;

  IF NOT v_has_membership THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  IF v_req.model_approval != 'approved' THEN
    RAISE EXCEPTION 'model_not_approved';
  END IF;

  IF v_req.final_status != 'option_confirmed' THEN
    RAISE EXCEPTION 'option_not_confirmed';
  END IF;

  UPDATE public.option_requests
  SET final_status = 'job_confirmed',
      status = 'confirmed',
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_confirm_job_agency_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_job_agency_only(uuid) TO authenticated;
