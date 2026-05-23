-- Defense-in-depth: Casting requests have no Axis-1 price negotiation.
-- Block price RPCs and direct UPDATEs on price fields when request_type = 'casting'.
-- Options and agency-only flows unchanged.

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
  v_request_type text;
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
         or2.agency_counter_price,
         COALESCE(or2.request_type::text, 'option')
  INTO   v_agency_id, v_agency_org_id, v_client_price_status, v_agency_counter, v_request_type
  FROM   public.option_requests or2
  WHERE  or2.id = p_request_id
    AND  or2.status IN ('in_negotiation', 'confirmed')
    AND  or2.final_status IS DISTINCT FROM 'job_confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_negotiation');
  END IF;

  IF v_request_type = 'casting' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_negotiation_not_applicable_for_casting');
  END IF;

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
    AND  COALESCE(request_type::text, 'option') <> 'casting'
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
  'Atomic counter-offer (Axis 1). Rejects casting requests (no price negotiation). 20261331.';

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
    AND  client_price_status = 'pending'
    AND  COALESCE(request_type::text, 'option') <> 'casting';

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
    AND client_price_status = 'pending'
    AND COALESCE(request_type::text, 'option') <> 'casting';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_confirm_client_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_client_price(UUID) TO authenticated;

COMMENT ON FUNCTION public.agency_confirm_client_price(UUID) IS
  'Agency accepts client proposed price (Axis 1). Rejects casting requests. 20261331.';

-- ─── 3. client_accept_counter_offer ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.client_accept_counter_offer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_client_id     UUID;
  v_org_id        UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT client_id, organization_id
  INTO   v_client_id, v_org_id
  FROM   public.option_requests
  WHERE  id = p_request_id
    AND  client_price_status = 'pending'
    AND  COALESCE(request_type::text, 'option') <> 'casting';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF NOT (
    v_client_id = auth.uid()
    OR (v_org_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM   public.organizations oc
      JOIN   public.organization_members mc ON mc.organization_id = oc.id
      WHERE  oc.id     = v_org_id
        AND  oc.type   = 'client'
        AND  mc.user_id = auth.uid()
    ))
    OR public.is_current_user_admin()
  ) THEN
    RAISE EXCEPTION 'client_accept_counter_offer: caller is not the client for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET
    client_price_status = 'accepted'
  WHERE id = p_request_id
    AND  client_price_status = 'pending'
    AND  COALESCE(request_type::text, 'option') <> 'casting';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.client_accept_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_accept_counter_offer(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_accept_counter_offer(UUID) IS
  'Client accepts agency counter-offer (Axis 1). Rejects casting requests. 20261331.';

-- ─── 4. client_reject_counter_offer ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.client_reject_counter_offer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_client_id UUID;
  v_org_id    UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT client_id, COALESCE(client_organization_id, organization_id)
  INTO v_client_id, v_org_id
  FROM public.option_requests
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND agency_counter_price IS NOT NULL
    AND COALESCE(request_type::text, 'option') <> 'casting';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF NOT (
    v_client_id = auth.uid()
    OR (v_org_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.organizations oc
        JOIN public.organization_members mc ON mc.organization_id = oc.id
        WHERE oc.id = v_org_id
          AND oc.type = 'client'
          AND mc.user_id = auth.uid()
      ))
  ) THEN
    RAISE EXCEPTION 'client_reject_counter_offer: caller is not the client for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET client_price_status = 'rejected'
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND agency_counter_price IS NOT NULL
    AND COALESCE(request_type::text, 'option') <> 'casting';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.client_reject_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_reject_counter_offer(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_reject_counter_offer(UUID) IS
  'Client declines agency counter-offer (Axis 1). Rejects casting requests. 20261331.';

-- ─── 5. Trigger: block direct price-axis UPDATE on casting rows ──────────────

CREATE OR REPLACE FUNCTION public.fn_block_casting_price_axis_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.request_type::text, 'option') = 'casting' THEN
    IF NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
       OR NEW.agency_counter_price IS DISTINCT FROM OLD.agency_counter_price
       OR NEW.client_price_status IS DISTINCT FROM OLD.client_price_status
    THEN
      RAISE EXCEPTION 'price_negotiation_not_applicable_for_casting'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_block_casting_price_axis_mutations ON public.option_requests;

CREATE TRIGGER tr_block_casting_price_axis_mutations
  BEFORE UPDATE OF proposed_price, agency_counter_price, client_price_status
  ON public.option_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_casting_price_axis_mutations();

COMMENT ON FUNCTION public.fn_block_casting_price_axis_mutations() IS
  'Blocks Axis-1 price field mutations on casting requests (direct UPDATE bypass). 20261331.';

-- ─── Verification ────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agency_set_counter_offer'
  ), 'FAIL: agency_set_counter_offer missing after 20261331';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_block_casting_price_axis_mutations'
  ), 'FAIL: fn_block_casting_price_axis_mutations missing after 20261331';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = 'option_requests'
      AND t.tgname = 'tr_block_casting_price_axis_mutations'
  ), 'FAIL: tr_block_casting_price_axis_mutations missing after 20261331';
END;
$$;
