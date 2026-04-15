-- =============================================================================
-- 20260815: Fix fn_validate_option_status_transition — allow final_status
-- option_confirmed → option_pending when status → rejected (model decline)
-- =============================================================================
-- ROOT CAUSE: tr_reset_final_status_on_rejection (20260555) fires BEFORE
-- trg_validate_option_status (20260711). The reset trigger sets
-- NEW.final_status := 'option_pending' when status → rejected. The validate
-- trigger then sees OLD.final_status = 'option_confirmed' and
-- NEW.final_status = 'option_pending' and raises an exception — blocking
-- every model decline.
--
-- FIX: Allow the option_confirmed → option_pending transition ONLY when
-- status is simultaneously transitioning to 'rejected'.
--
-- Also adds 'model_declined_availability' kind to
-- insert_option_request_system_message so model rejection emits a
-- visible system message in the negotiation thread.
-- =============================================================================

-- 1) Fix the validation trigger function
CREATE OR REPLACE FUNCTION public.fn_validate_option_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- status: rejected is terminal
  IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition rejected → %. Rejected is terminal.',
      NEW.status
    USING ERRCODE = 'P0001';
  END IF;

  -- status: confirmed cannot revert to in_negotiation
  IF OLD.status = 'confirmed' AND NEW.status = 'in_negotiation' THEN
    RAISE EXCEPTION
      'option_requests: illegal status transition confirmed → in_negotiation. Confirmed cannot be reversed.'
    USING ERRCODE = 'P0001';
  END IF;

  -- final_status: job_confirmed is terminal
  IF OLD.final_status = 'job_confirmed' AND NEW.final_status IS DISTINCT FROM 'job_confirmed' THEN
    RAISE EXCEPTION
      'option_requests: illegal final_status transition job_confirmed → %. job_confirmed is terminal.',
      COALESCE(NEW.final_status, 'NULL')
    USING ERRCODE = 'P0001';
  END IF;

  -- final_status: option_confirmed cannot revert to option_pending
  -- EXCEPTION: allowed when status → rejected (model decline resets final_status
  -- via tr_reset_final_status_on_rejection; that trigger fires before this one)
  IF OLD.final_status = 'option_confirmed' AND NEW.final_status = 'option_pending' THEN
    IF NOT (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected') THEN
      RAISE EXCEPTION
        'option_requests: illegal final_status transition option_confirmed → option_pending.'
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- model_approval: rejected is terminal
  IF OLD.model_approval = 'rejected'
     AND NEW.model_approval IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition rejected → %. Model rejection is terminal.',
      NEW.model_approval
    USING ERRCODE = 'P0001';
  END IF;

  -- model_approval: approved cannot revert to pending
  IF OLD.model_approval = 'approved'
     AND NEW.model_approval = 'pending' THEN
    RAISE EXCEPTION
      'option_requests: illegal model_approval transition approved → pending.'
    USING ERRCODE = 'P0001';
  END IF;

  -- model_approval: cannot approve on an already-rejected request (timing exploit)
  IF NEW.status = 'rejected' AND NEW.model_approval = 'approved'
     AND OLD.model_approval = 'pending' AND OLD.status != 'rejected' THEN
    NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_validate_option_status_transition() IS
  'Trigger function: enforces the option_requests status state machine at DB level. '
  'Guards: status (rejected terminal, confirmed→in_negotiation blocked), '
  'final_status (job_confirmed terminal, option_confirmed→option_pending blocked '
  'UNLESS status→rejected i.e. model decline), '
  'model_approval (rejected terminal, approved→pending blocked). '
  'Fix 20260815: allow final_status reset on rejection (trigger chain with 20260555).';

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS trg_validate_option_status ON public.option_requests;

CREATE TRIGGER trg_validate_option_status
  BEFORE UPDATE OF status, final_status, model_approval
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_option_status_transition();

-- Verify
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_option_status'
  ), 'trg_validate_option_status trigger must exist after migration';
END;
$$;


-- 2) Add 'model_declined_availability' kind to system message RPC
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
  v_visible_to_model boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.option_request_visible_to_me(p_option_request_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_kind = 'agency_counter_offer' THEN
    IF p_price IS NULL OR p_currency IS NULL OR trim(p_currency) = '' THEN
      RAISE EXCEPTION 'agency_counter_offer requires p_price and p_currency';
    END IF;
    v_text := format('Agency proposed %s %s.', trim(p_price::text), trim(p_currency));
    v_visible_to_model := false;
  ELSIF v_kind = 'no_model_account' THEN
    v_text :=
      'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.';
    v_visible_to_model := false;
  ELSIF v_kind = 'no_model_account_client_notice' THEN
    v_text :=
      'No model app account on file. The agency can negotiate and confirm with you without waiting for model approval. When confirmed, the booking appears in both calendars.';
    v_visible_to_model := false;
  ELSIF v_kind = 'agency_confirmed_availability' THEN
    v_text := 'Agency confirmed availability for this option.';
  ELSIF v_kind = 'agency_accepted_price' THEN
    v_text := 'Agency accepted the proposed fee.';
    v_visible_to_model := false;
  ELSIF v_kind = 'agency_declined_price' THEN
    v_text := 'Agency declined the proposed fee. A counter offer can be sent below.';
    v_visible_to_model := false;
  ELSIF v_kind = 'client_accepted_counter' THEN
    v_text := 'Client accepted the agency proposal.';
    v_visible_to_model := false;
  ELSIF v_kind = 'client_rejected_counter' THEN
    v_text := 'Client declined the counter offer.';
    v_visible_to_model := false;
  ELSIF v_kind = 'job_confirmed_by_client' THEN
    v_text := 'Job confirmed by client.';
  ELSIF v_kind = 'job_confirmed_by_agency' THEN
    v_text := 'Job confirmed by agency.';
  ELSIF v_kind = 'model_approved_booking' THEN
    v_text := '✓ Approved by Model';
  ELSIF v_kind = 'model_declined_availability' THEN
    v_text := 'Model declined the availability request.';
  ELSE
    RAISE EXCEPTION 'invalid_system_message_kind: %', p_kind;
  END IF;

  PERFORM set_config('app.option_request_system_message', '1', true);

  INSERT INTO public.option_request_messages (option_request_id, from_role, text, visible_to_model)
  VALUES (p_option_request_id, 'system'::public.chat_sender_type, v_text, v_visible_to_model)
  RETURNING id INTO v_id;

  PERFORM set_config('app.option_request_system_message', '', true);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) IS
  'Workflow-only option_request_messages with from_role=system. Text mirrors uiCopy.systemMessages; '
  'guarded by option_request_visible_to_me + trigger session flag. '
  'Kinds: no_model_account, no_model_account_client_notice, agency_confirmed_availability, '
  'agency_accepted_price, agency_declined_price, agency_counter_offer, client_accepted_counter, '
  'client_rejected_counter, job_confirmed_by_client, job_confirmed_by_agency, model_approved_booking, '
  'model_declined_availability (20260815).';
