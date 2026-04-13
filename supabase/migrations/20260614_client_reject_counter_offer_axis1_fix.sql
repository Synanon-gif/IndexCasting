-- Migration: 20260614_client_reject_counter_offer_axis1_fix.sql
--
-- Purpose: Remove the `final_status = 'option_pending'` guard from the
-- `client_reject_counter_offer` RPC so that clients can decline an agency
-- counter-proposal regardless of whether the agency has already confirmed
-- availability (final_status = 'option_confirmed').
--
-- Background (Axis 1 / Axis 2 independence — system-invariants.mdc §K):
-- Price negotiation (Axis 1) and availability confirmation (Axis 2) are
-- fully independent. The previous WHERE clause tied a price-only action to
-- an availability field, violating this invariant and causing the RPC to
-- silently return FALSE once the agency had confirmed availability.
--
-- The UPDATE only touches `client_price_status` — it never modifies
-- `final_status` — so removing the availability guard is safe.

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
  -- Guard 1: authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Guard 2: resolve caller identity from the request row.
  -- Axis 1/2 independence: `final_status` intentionally NOT checked here.
  -- Only price-axis fields are required: counter must be outstanding (pending)
  -- and an agency_counter_price must exist.
  SELECT client_id, COALESCE(client_organization_id, organization_id)
  INTO v_client_id, v_org_id
  FROM public.option_requests
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND agency_counter_price IS NOT NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Guard 3: caller must be the client user or a member of the client org
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

  -- Axis 1 write: only client_price_status is updated; final_status unchanged.
  UPDATE public.option_requests
  SET client_price_status = 'rejected'
  WHERE id = p_request_id
    AND client_price_status = 'pending'
    AND agency_counter_price IS NOT NULL;

  RETURN FOUND;
END;
$$;

-- Explicit privilege grant (consistent with existing RPC security model)
REVOKE ALL ON FUNCTION public.client_reject_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_reject_counter_offer(UUID) TO authenticated;
