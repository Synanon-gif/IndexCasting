-- =============================================================================
-- C1 Fix: Atomic agency_set_counter_offer RPC
--
-- Problem: setAgencyCounterOffer in TypeScript calls acquire_option_request_lock
-- (RPC, own transaction) then a separate PostgREST .update() (second transaction).
-- The advisory lock releases at COMMIT of the first transaction, so the second
-- transaction is NOT protected — concurrent bookers can race.
--
-- Fix: Single SECURITY DEFINER RPC that acquires the advisory lock AND performs
-- the update atomically within one transaction.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

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
BEGIN
  -- Guard 1: Authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'option_request_id required';
  END IF;

  IF p_counter_price IS NULL OR p_counter_price < 0 THEN
    RAISE EXCEPTION 'counter_price must be non-negative';
  END IF;

  -- Guard 2: Advisory lock (transaction-scoped, released at COMMIT)
  v_lock_key := ('x' || substr(replace(p_request_id::text, '-', ''), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Guard 3: Verify caller is agency member for this request
  SELECT or2.agency_id, or2.agency_organization_id
  INTO   v_agency_id, v_agency_org_id
  FROM   public.option_requests or2
  WHERE  or2.id     = p_request_id
    AND  or2.status = 'in_negotiation';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_negotiation');
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

  -- Atomic update: lock is still held within this transaction
  UPDATE public.option_requests
  SET    agency_counter_price = p_counter_price,
         client_price_status  = 'pending'
  WHERE  id     = p_request_id
    AND  status = 'in_negotiation'
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
  'Atomic counter-offer: acquires advisory lock + performs update in one transaction. '
  'Replaces the two-roundtrip pattern (acquire_lock RPC + PostgREST update). 20260818.';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agency_set_counter_offer'
  ), 'FAIL: agency_set_counter_offer missing after 20260818 migration';
END;
$$;
