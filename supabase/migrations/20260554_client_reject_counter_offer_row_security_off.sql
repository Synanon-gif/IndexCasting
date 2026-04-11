-- =============================================================================
-- 20260554: Add SET row_security TO off to client_reject_counter_offer
-- Audit finding S-1: SECURITY DEFINER without row_security=off can cause
-- UPDATE failures under PG15+ when RLS re-evaluates inside the function.
-- This redeploys the same logic from 20260550 with the missing directive.
-- =============================================================================

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
  'SECURITY DEFINER + row_security=off — 20260554 (audit fix S-1).';
