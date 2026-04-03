-- EXPLOIT-M1 Fix: updateOptionRequestSchedule role guard
--
-- Problem: updateOptionRequestSchedule() in the client performed a direct
-- UPDATE on option_requests with only a status guard (.neq('status','rejected')).
-- A client user could call this function and freely change the date/time of any
-- confirmed option, because the RLS UPDATE policy option_request_visible_to_me()
-- applies to ALL fields and does not distinguish roles.
--
-- Fix: SECURITY DEFINER RPC agency_update_option_schedule() that validates:
--   1. The caller is an authenticated agency org member for this request.
--   2. The option is not in a terminal state (rejected / job_confirmed).
--   3. The date format is valid.

CREATE OR REPLACE FUNCTION public.agency_update_option_schedule(
  p_option_id   uuid,
  p_date        date,
  p_start_time  text DEFAULT NULL,
  p_end_time    text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req       option_requests%ROWTYPE;
  v_agency_id uuid;
  v_is_member boolean;
BEGIN
  -- Load the option request
  SELECT * INTO v_req
  FROM option_requests
  WHERE id = p_option_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Option request not found: %', p_option_id;
  END IF;

  -- Terminal-state guard: cannot reschedule rejected or job-confirmed requests
  IF v_req.status = 'rejected' OR v_req.final_status = 'job_confirmed' THEN
    RAISE EXCEPTION 'Cannot reschedule a request in terminal state (status=%, final_status=%)',
      v_req.status, v_req.final_status;
  END IF;

  -- Role guard: caller must be a member of the agency org for this request.
  -- Look up the agency's organization from the agencies table.
  SELECT o.id INTO v_agency_id
  FROM organizations o
  WHERE o.agency_id = v_req.agency_id
  LIMIT 1;

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Agency organization not found for agency_id=%', v_req.agency_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = v_agency_id
      AND om.user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Forbidden: caller is not a member of the agency organization';
  END IF;

  -- All guards passed — perform the update.
  UPDATE option_requests
  SET
    requested_date = p_date,
    start_time     = NULLIF(p_start_time, ''),
    end_time       = NULLIF(p_end_time, ''),
    updated_at     = now()
  WHERE id = p_option_id;

  RETURN true;
END;
$$;

-- Only authenticated users may call this RPC; actual role check is inside the function.
REVOKE ALL ON FUNCTION public.agency_update_option_schedule FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_update_option_schedule TO authenticated;

COMMENT ON FUNCTION public.agency_update_option_schedule IS
  'EXPLOIT-M1 fix: SECURITY DEFINER RPC that restricts date/time updates on
   option_requests to authenticated agency org members only. Replaces the
   direct client-side UPDATE that had no role guard.';
