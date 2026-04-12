-- Decouple availability confirmation from price acceptance in the negotiation footer.
--
-- Adds 'agency_confirmed_availability' as a new system message kind.
-- This aligns with the store-layer split:
--   agencyConfirmAvailabilityStore → Axis 2 (final_status only)
--   agencyAcceptClientPriceStore   → Axis 1 (client_price_status only)

-- Recreate insert_option_request_system_message with the new kind in the allowlist.
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

REVOKE ALL    ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) IS
  'Inserts a system workflow message into option_request_messages. '
  'Allowlisted kinds only. agency_confirmed_availability added 20260616.';
