-- RPC: agency_confirm_job_agency_only
-- CANONICAL INVARIANT: Only allowed when is_agency_only=true.
-- Client-driven flow uses client_confirm_option_job instead.
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
  -- GUARD 1: Authentication
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Fetch the request
  SELECT * INTO v_req
  FROM public.option_requests
  WHERE id = p_request_id;

  IF v_req IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  -- GUARD 2: Must be agency-only flow
  IF NOT v_req.is_agency_only THEN
    RAISE EXCEPTION 'not_agency_only_flow';
  END IF;

  -- GUARD 3: Caller is agency org member
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

  -- GUARD 4: Model must have approved availability
  IF v_req.model_approval != 'approved' THEN
    RAISE EXCEPTION 'model_not_approved';
  END IF;

  -- GUARD 5: Option must be confirmed
  IF v_req.final_status != 'option_confirmed' THEN
    RAISE EXCEPTION 'option_not_confirmed';
  END IF;

  -- ACTION: Set job_confirmed
  UPDATE public.option_requests
  SET final_status = 'job_confirmed',
      status = 'confirmed',
      updated_at = now()
  WHERE id = p_request_id;

  -- System message
  PERFORM public.insert_option_request_system_message(
    p_request_id,
    'job_confirmed_by_client'
  );

  RETURN true;
END;
$$;
