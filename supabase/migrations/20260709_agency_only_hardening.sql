-- H2 + M2: Combined migration
-- 1) Add job_confirmed_by_agency kind to insert_option_request_system_message
-- 2) Update agency_confirm_job_agency_only to use job_confirmed_by_agency
-- 3) Add agency_organization_name column to option_requests
-- 4) Update agency_create_option_request to resolve and store agency org name

-- ===== 1) option_requests.agency_organization_name =====
ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS agency_organization_name text;

COMMENT ON COLUMN public.option_requests.agency_organization_name IS
  'Denormalized agency org display name. Set on agency-only requests so models see which agency created the event.';

-- ===== 2) Rebuild insert_option_request_system_message with job_confirmed_by_agency kind =====
CREATE OR REPLACE FUNCTION public.insert_option_request_system_message(
  p_option_request_id uuid,
  p_kind text,
  p_price numeric DEFAULT NULL,
  p_currency text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_text text;
  v_id uuid;
  v_kind text := trim(lower(COALESCE(p_kind, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.option_request_visible_to_me(p_option_request_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_kind = 'no_model_account' THEN
    v_text :=
      'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.';
  ELSIF v_kind = 'no_model_account_client_notice' THEN
    v_text :=
      'No model app account on file. The agency can negotiate and confirm with you without waiting for model approval. When confirmed, the booking appears in both calendars.';
  ELSIF v_kind = 'agency_confirmed_availability' THEN
    v_text := 'Agency confirmed availability for this option.';
  ELSIF v_kind = 'agency_accepted_price' THEN
    v_text := 'Agency accepted the proposed fee.';
  ELSIF v_kind = 'agency_declined_price' THEN
    v_text := 'Agency declined the proposed fee. A counter offer can be sent below.';
  ELSIF v_kind = 'client_accepted_counter' THEN
    v_text := 'Client accepted the agency proposal.';
  ELSIF v_kind = 'client_rejected_counter' THEN
    v_text := 'Client declined the counter offer. The agency can send a new counter offer.';
  ELSIF v_kind = 'job_confirmed_by_client' THEN
    v_text := 'Job confirmed by client.';
  ELSIF v_kind = 'job_confirmed_by_agency' THEN
    v_text := 'Job confirmed by agency.';
  ELSIF v_kind = 'model_approved_booking' THEN
    v_text := E'\u2713 Approved by Model';
  ELSIF v_kind = 'agency_counter_offer' THEN
    v_text := format('Agency proposed %s %s.', p_price, COALESCE(p_currency, 'EUR'));
  ELSE
    RAISE EXCEPTION 'invalid_system_message_kind: %', p_kind;
  END IF;

  PERFORM set_config('app.option_request_system_message', '1', true);

  INSERT INTO public.option_request_messages (option_request_id, from_role, text)
  VALUES (p_option_request_id, 'system', v_text)
  RETURNING id INTO v_id;

  PERFORM set_config('app.option_request_system_message', '', true);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) TO authenticated;

-- ===== 3) Rebuild agency_confirm_job_agency_only with correct kind =====
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

  PERFORM public.insert_option_request_system_message(
    p_request_id,
    'job_confirmed_by_agency'
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_confirm_job_agency_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_job_agency_only(uuid) TO authenticated;

-- ===== 4) Rebuild agency_create_option_request with agency org name resolution =====
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
  v_agency_org_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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

  SELECT agency_id INTO v_model_agency_id
  FROM public.models WHERE id = p_model_id;

  IF v_model_agency_id IS NULL OR v_model_agency_id != p_agency_id THEN
    RAISE EXCEPTION 'model_not_in_agency';
  END IF;

  SELECT
    COALESCE(m.first_name || ' ' || m.last_name, m.first_name, 'Model'),
    (m.user_id IS NOT NULL)
  INTO v_model_name, v_model_has_account
  FROM public.models m WHERE m.id = p_model_id;

  -- Resolve agency organization name for model visibility
  SELECT o.name INTO v_agency_org_name
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id::uuid
    AND o.type = 'agency'
  LIMIT 1;

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
    agency_organization_name,
    created_by,
    model_account_linked
  ) VALUES (
    v_caller_id::text,
    p_model_id,
    p_agency_id,
    p_requested_date,
    COALESCE(p_request_type, 'option'),
    COALESCE(p_title, v_agency_org_name, 'Agency Event'),
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
    v_agency_org_name,
    v_caller_id,
    v_model_has_account
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_create_option_request(uuid, text, date, text, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_create_option_request(uuid, text, date, text, text, text, text, text, uuid, uuid) TO authenticated;
