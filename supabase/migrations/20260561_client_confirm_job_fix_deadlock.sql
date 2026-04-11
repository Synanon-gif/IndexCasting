-- M4: Fix deadlock when model pre-approved + counter-offer accepted.
-- After counter-accept, status stays 'in_negotiation' but model_approval is already 'approved'.
-- Allow job confirmation for linked models when model_approval = 'approved' regardless of status,
-- since price is settled and model has approved.

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
    COALESCE(request_type::text, 'option')
  INTO v_client_id, v_org_id, v_model_linked, v_model_approval, v_status, v_req_type
  FROM public.option_requests
  WHERE id = p_request_id
    AND client_price_status = 'accepted'
    AND final_status = 'option_confirmed';

  IF NOT FOUND THEN
    RETURN FALSE;
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
    -- Model must have approved; status may still be 'in_negotiation' after counter-accept flow.
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
