-- Decouple price RPCs from availability confirmation.
--
-- Previously, agency_confirm_client_price and client_accept_counter_offer
-- set BOTH client_price_status = 'accepted' AND final_status = 'option_confirmed'.
-- This coupled price agreement with availability confirmation.
--
-- After this migration:
-- - Price RPCs ONLY handle client_price_status (Axis 1 — price).
-- - Availability (Axis 2) is handled independently by agencyAcceptRequest
--   (TypeScript) which sets final_status = 'option_confirmed'.
-- - Job confirmation (client_confirm_option_job) still requires BOTH axes.

-- ─── 1. agency_confirm_client_price — price only ─────────────────────────────

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
    AND  status              = 'in_negotiation'
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
  ) AND NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'agency_confirm_client_price: caller is not a member of the agency for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.option_requests
  SET
    client_price_status = 'accepted'
  WHERE id = p_request_id
    AND status              = 'in_negotiation'
    AND client_price_status = 'pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_confirm_client_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_client_price(UUID) TO authenticated;

COMMENT ON FUNCTION public.agency_confirm_client_price(UUID) IS
  'Agency accepts the client''s proposed price (Axis 1 — price only). '
  'Does NOT change final_status (availability). '
  'SECURITY DEFINER — cannot be spoofed by a client.';


-- ─── 2. client_accept_counter_offer — price only ─────────────────────────────

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
  SELECT client_id, organization_id
  INTO   v_client_id, v_org_id
  FROM   public.option_requests
  WHERE  id = p_request_id
    AND  client_price_status = 'pending';

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
    AND  client_price_status = 'pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.client_accept_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_accept_counter_offer(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_accept_counter_offer(UUID) IS
  'Client accepts the agency''s counter-offer (Axis 1 — price only). '
  'Does NOT change final_status (availability). '
  'SECURITY DEFINER — cannot be spoofed by agency.';


-- ─── Verification ────────────────────────────────────────────────────────────

SELECT routine_name
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name IN ('agency_confirm_client_price', 'client_accept_counter_offer');
