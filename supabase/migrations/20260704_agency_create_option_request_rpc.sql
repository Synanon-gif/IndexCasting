-- RPC: agency_create_option_request
-- Agency-only manual event creation (no client party, no price negotiation).
-- SECURITY DEFINER with row_security=off: internal guards enforce auth + membership + model ownership.
CREATE OR REPLACE FUNCTION public.agency_create_option_request(
  p_model_id uuid,
  p_agency_id text,
  p_requested_date date,
  p_request_type text DEFAULT 'option',
  p_title text DEFAULT NULL,
  p_job_description text DEFAULT NULL,
  p_start_time text DEFAULT NULL,
  p_end_time text DEFAULT NULL,
  p_agency_event_group_id uuid DEFAULT NULL,
  p_agency_organization_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_id uuid;
  v_has_membership boolean;
  v_model_agency_id text;
  v_request_id uuid;
  v_model_name text;
  v_model_has_account boolean;
BEGIN
  -- GUARD 1: Authentication
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller is agency org member or booker for this agency
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_caller_id
      AND o.agency_id = p_agency_id::uuid
      AND o.type = 'agency'
    UNION ALL
    SELECT 1
    FROM public.bookers
    WHERE agency_id = p_agency_id AND user_id = v_caller_id
  ) INTO v_has_membership;

  IF NOT v_has_membership THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- GUARD 3: Model belongs to this agency
  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF v_model_agency_id IS NULL OR v_model_agency_id != p_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
  END IF;

  -- Resolve model name and account status
  SELECT
    COALESCE(m.first_name || ' ' || m.last_name, m.first_name, 'Model'),
    (m.user_id IS NOT NULL)
  INTO v_model_name, v_model_has_account
  FROM public.models m WHERE m.id = p_model_id;

  -- INSERT option_request with is_agency_only=true
  INSERT INTO public.option_requests (
    client_id,
    model_id,
    agency_id,
    requested_date,
    request_type,
    client_name,
    model_name,
    job_description,
    proposed_price,
    agency_counter_price,
    client_price_status,
    status,
    final_status,
    is_agency_only,
    agency_event_group_id,
    agency_organization_id,
    organization_id,
    client_organization_id,
    created_by,
    model_account_linked
  ) VALUES (
    v_caller_id::text,
    p_model_id,
    p_agency_id,
    p_requested_date,
    COALESCE(p_request_type, 'option'),
    COALESCE(p_title, 'Agency Event'),
    v_model_name,
    p_job_description,
    NULL,
    NULL,
    'accepted',
    'in_negotiation',
    'option_pending',
    true,
    p_agency_event_group_id,
    p_agency_organization_id,
    p_agency_organization_id,
    NULL,
    v_caller_id,
    v_model_has_account
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;
