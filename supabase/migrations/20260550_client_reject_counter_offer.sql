-- =============================================================================
-- 20260550: client_reject_counter_offer RPC + system message copy (counter reject)
-- Client declines agency counter: client_price_status only (negotiation stays open).
-- Text for client_rejected_counter mirrors uiCopy.systemMessages.clientRejectedCounter.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.client_reject_counter_offer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id UUID;
  v_org_id    UUID;
BEGIN
  SELECT client_id, COALESCE(client_organization_id, organization_id)
  INTO v_client_id, v_org_id
  FROM public.option_requests
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND final_status = 'option_pending'
    AND agency_counter_price IS NOT NULL;

  IF NOT FOUND THEN
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
    RAISE EXCEPTION 'client_reject_counter_offer: caller is not the client for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET client_price_status = 'rejected'
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND final_status = 'option_pending'
    AND agency_counter_price IS NOT NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.client_reject_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_reject_counter_offer(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_reject_counter_offer(UUID) IS
  'Client declines the agency counter-offer (client_price_status=rejected only). '
  'Does not set option_requests.status to rejected — negotiation remains open for a new counter. '
  'SECURITY DEFINER — 20260550.';

-- Keep insert_option_request_system_message in sync with uiCopy (client_rejected_counter line).
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

  IF v_kind = 'agency_counter_offer' THEN
    IF p_price IS NULL OR p_currency IS NULL OR trim(p_currency) = '' THEN
      RAISE EXCEPTION 'agency_counter_offer requires p_price and p_currency';
    END IF;
    v_text := format('Agency proposed %s %s.', trim(p_price::text), trim(p_currency));
  ELSIF v_kind = 'no_model_account' THEN
    v_text :=
      'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.';
  ELSIF v_kind = 'no_model_account_client_notice' THEN
    v_text :=
      'No model app account on file. The agency can negotiate and confirm with you without waiting for model approval. When confirmed, the booking appears in both calendars.';
  ELSIF v_kind = 'agency_accepted_price' THEN
    v_text := 'Agency accepted the proposed fee.';
  ELSIF v_kind = 'agency_declined_price' THEN
    v_text := 'Agency declined the proposed fee. A counter offer can be sent below.';
  ELSIF v_kind = 'client_accepted_counter' THEN
    v_text := 'Client accepted the agency proposal.';
  ELSIF v_kind = 'client_rejected_counter' THEN
    v_text :=
      'Client declined the counter offer. The agency can send a new counter offer.';
  ELSIF v_kind = 'job_confirmed_by_client' THEN
    v_text := 'Job confirmed by client.';
  ELSIF v_kind = 'model_approved_booking' THEN
    v_text := '✓ Approved by Model';
  ELSE
    RAISE EXCEPTION 'invalid_system_message_kind: %', p_kind;
  END IF;

  PERFORM set_config('app.option_request_system_message', '1', true);

  INSERT INTO public.option_request_messages (option_request_id, from_role, text)
  VALUES (p_option_request_id, 'system'::public.chat_sender_type, v_text)
  RETURNING id INTO v_id;

  PERFORM set_config('app.option_request_system_message', '', true);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.insert_option_request_system_message(uuid, text, numeric, text) IS
  'Workflow-only option_request_messages with from_role=system. Text mirrors uiCopy.systemMessages; '
  'guarded by option_request_visible_to_me + trigger session flag. 20260550: client_rejected_counter copy.';

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'client_reject_counter_offer';
