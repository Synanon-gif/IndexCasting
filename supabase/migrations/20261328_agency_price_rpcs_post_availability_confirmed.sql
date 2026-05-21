-- Allow agency Axis-1 price actions when availability is confirmed (status='confirmed')
-- but price negotiation is still open — mirrors client_accept_counter_offer (no status guard).

-- ─── 1. agency_set_counter_offer ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agency_set_counter_offer(
  p_request_id   uuid,
  p_counter_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_lock_key   bigint;
  v_agency_id  uuid;
  v_agency_org_id uuid;
  v_row_id     uuid;
  v_client_price_status text;
  v_agency_counter numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'option_request_id required';
  END IF;

  IF p_counter_price IS NULL OR p_counter_price < 0 THEN
    RAISE EXCEPTION 'counter_price must be non-negative';
  END IF;

  v_lock_key := ('x' || substr(replace(p_request_id::text, '-', ''), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT or2.agency_id,
         or2.agency_organization_id,
         or2.client_price_status,
         or2.agency_counter_price
  INTO   v_agency_id, v_agency_org_id, v_client_price_status, v_agency_counter
  FROM   public.option_requests or2
  WHERE  or2.id = p_request_id
    AND  or2.status IN ('in_negotiation', 'confirmed')
    AND  or2.final_status IS DISTINCT FROM 'job_confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_negotiation');
  END IF;

  -- Block superseding a counter while the client is still deciding (pending + counter set).
  IF v_client_price_status = 'pending' AND v_agency_counter IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'awaiting_client_response');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM   public.organizations oa
    JOIN   public.organization_members ma ON ma.organization_id = oa.id
    WHERE  oa.agency_id = v_agency_id
      AND  oa.type      = 'agency'
      AND  ma.user_id   = auth.uid()
      AND  ma.role IN ('owner', 'booker')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.bookers
    WHERE agency_id = v_agency_id AND user_id = auth.uid()
  ) AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'access_denied: caller is not a member of the agency'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET    agency_counter_price = p_counter_price,
         client_price_status  = 'pending'
  WHERE  id = p_request_id
    AND  status IN ('in_negotiation', 'confirmed')
    AND  final_status IS DISTINCT FROM 'job_confirmed'
    AND  (
      client_price_status = 'rejected'
      OR agency_counter_price IS NULL
    )
  RETURNING id INTO v_row_id;

  IF v_row_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_negotiation');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'agency_id', v_agency_id,
    'agency_organization_id', v_agency_org_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_set_counter_offer(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_set_counter_offer(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.agency_set_counter_offer(uuid, numeric) IS
  'Atomic counter-offer (Axis 1). Allowed while status in (in_negotiation, confirmed) and price not settled. '
  'Blocks new counters while client_price_status=pending and agency_counter_price already set. 20261328.';

-- ─── 2. agency_confirm_client_price ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agency_confirm_client_price(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_agency_id UUID;
BEGIN
  SELECT agency_id INTO v_agency_id
  FROM   public.option_requests
  WHERE  id = p_request_id
    AND  status IN ('in_negotiation', 'confirmed')
    AND  final_status IS DISTINCT FROM 'job_confirmed'
    AND  client_price_status = 'pending';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM   public.organizations oa
    JOIN   public.organization_members ma ON ma.organization_id = oa.id
    WHERE  oa.agency_id = v_agency_id
      AND  oa.type      = 'agency'
      AND  ma.user_id   = auth.uid()
      AND  ma.role IN ('owner', 'booker')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.bookers
    WHERE agency_id = v_agency_id AND user_id = auth.uid()
  ) AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'agency_confirm_client_price: caller is not a member of the agency for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET
    client_price_status = 'accepted'
  WHERE id = p_request_id
    AND status IN ('in_negotiation', 'confirmed')
    AND final_status IS DISTINCT FROM 'job_confirmed'
    AND client_price_status = 'pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_confirm_client_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_client_price(UUID) TO authenticated;

COMMENT ON FUNCTION public.agency_confirm_client_price(UUID) IS
  'Agency accepts client proposed price (Axis 1). Allowed while status in (in_negotiation, confirmed). 20261328.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agency_set_counter_offer'
  ), 'FAIL: agency_set_counter_offer missing after 20261328';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agency_confirm_client_price'
  ), 'FAIL: agency_confirm_client_price missing after 20261328';
END;
$$;
