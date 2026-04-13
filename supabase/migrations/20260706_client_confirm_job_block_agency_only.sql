-- C1: Defense-in-depth — block client_confirm_option_job for agency-only requests.
-- Agency-only flow MUST use agency_confirm_job_agency_only instead.
CREATE OR REPLACE FUNCTION public.client_confirm_option_job(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_client_id     UUID;
  v_org_id        UUID;
  v_model_linked  BOOLEAN;
  v_model_approval TEXT;
  v_status        TEXT;
  v_req_type      TEXT;
  v_is_agency_only BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    client_id,
    COALESCE(client_organization_id, organization_id),
    COALESCE(model_account_linked, false),
    model_approval::text,
    status::text,
    COALESCE(request_type::text, 'option'),
    COALESCE(is_agency_only, false)
  INTO v_client_id, v_org_id, v_model_linked, v_model_approval, v_status, v_req_type, v_is_agency_only
  FROM public.option_requests
  WHERE id = p_request_id
    AND client_price_status = 'accepted'
    AND final_status = 'option_confirmed';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Agency-only requests must use agency_confirm_job_agency_only
  IF v_is_agency_only THEN
    RAISE EXCEPTION 'use_agency_confirm_job_for_agency_only_flow'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_req_type IS DISTINCT FROM 'option' THEN
    RETURN FALSE;
  END IF;

  IF NOT (
    v_client_id = auth.uid()
    OR (
      v_org_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organizations oc
        JOIN public.organization_members mc ON mc.organization_id = oc.id
        WHERE oc.id = v_org_id
          AND oc.type = 'client'
          AND mc.user_id = auth.uid()
      )
    )
  ) THEN
    RAISE EXCEPTION 'client_confirm_option_job: caller is not the client for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_model_linked THEN
    IF v_model_approval IS DISTINCT FROM 'approved' THEN
      RETURN FALSE;
    END IF;
    IF v_status NOT IN ('in_negotiation', 'confirmed') THEN
      RETURN FALSE;
    END IF;
  ELSE
    IF v_status NOT IN ('in_negotiation', 'confirmed') THEN
      RETURN FALSE;
    END IF;
  END IF;

  UPDATE public.option_requests
  SET
    final_status = 'job_confirmed',
    status = 'confirmed'
  WHERE id = p_request_id
    AND client_price_status = 'accepted'
    AND final_status = 'option_confirmed'
    AND COALESCE(is_agency_only, false) = false
    AND COALESCE(request_type::text, 'option') = 'option'
    AND (
      (
        COALESCE(model_account_linked, false)
        AND model_approval = 'approved'
        AND status IN ('in_negotiation', 'confirmed')
      )
      OR (
        NOT COALESCE(model_account_linked, false)
        AND status IN ('in_negotiation', 'confirmed')
      )
    );

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.client_confirm_option_job(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_confirm_option_job(UUID) TO authenticated;
