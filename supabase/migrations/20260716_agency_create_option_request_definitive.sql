-- DEFINITIVE agency_create_option_request — merges ALL prior fixes:
--   - 20260713: p_agency_id uuid (not text), start_time/end_time in INSERT
--   - 20260714_calendar_and_approval: INSERT+UPDATE for calendar triggers, model_approval, created_by_agency
--   - 20260714_fix_model_name: m.name instead of m.first_name/m.last_name
--
-- This migration supersedes all previous definitions of agency_create_option_request.
-- The INSERT+UPDATE pattern is MANDATORY: fn_ensure_calendar_on_option_confirmed is AFTER UPDATE,
-- so a single INSERT with option_confirmed would NOT fire the calendar trigger.

CREATE OR REPLACE FUNCTION public.agency_create_option_request(
  p_model_id uuid,
  p_agency_id uuid,
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
  v_model_agency_id uuid;
  v_request_id uuid;
  v_model_name text;
  v_model_has_account boolean;
  v_agency_org_name text;
  v_model_approval text;
BEGIN
  -- GUARD 1: Authentication
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller is agency org member or legacy booker for this agency
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_caller_id
      AND o.agency_id = p_agency_id
      AND o.type = 'agency'
    UNION ALL
    SELECT 1
    FROM public.bookers
    WHERE agency_id = p_agency_id
      AND user_id = v_caller_id
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

  -- Resolve model name (single 'name' column) and account status
  SELECT
    COALESCE(m.name, 'Model'),
    (m.user_id IS NOT NULL)
  INTO v_model_name, v_model_has_account
  FROM public.models m WHERE m.id = p_model_id;

  v_model_approval := CASE WHEN v_model_has_account THEN 'pending' ELSE 'approved' END;

  -- Resolve agency organization name
  -- LIMIT 1 after verified membership guard — safe sub-resource lookup
  SELECT o.name INTO v_agency_org_name
  FROM public.organizations o
  WHERE o.agency_id = p_agency_id
    AND o.type = 'agency'
  LIMIT 1;

  -- STEP 1: INSERT with final_status = 'option_pending'
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
    model_account_linked,
    model_approval,
    start_time,
    end_time
  ) VALUES (
    v_caller_id,
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
    v_model_has_account,
    v_model_approval,
    p_start_time::time,
    p_end_time::time
  )
  RETURNING id INTO v_request_id;

  -- STEP 2: UPDATE to option_confirmed — fires AFTER UPDATE triggers:
  --   fn_ensure_calendar_on_option_confirmed → creates calendar_entries
  --   sync_user_calendars_on_option_confirmed → creates user_calendar_events
  UPDATE public.option_requests
  SET final_status = 'option_confirmed'
  WHERE id = v_request_id;

  -- STEP 3: Mark calendar entry as agency-created
  UPDATE public.calendar_entries
  SET created_by_agency = true
  WHERE option_request_id = v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agency_create_option_request(uuid, uuid, date, text, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_create_option_request(uuid, uuid, date, text, text, text, text, text, uuid, uuid) TO authenticated;
