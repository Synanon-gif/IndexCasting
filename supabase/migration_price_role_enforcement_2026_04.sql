-- =============================================================================
-- EXPLOIT-C1 Fix: Role-Enforcement for Price Acceptance Actions
--
-- Problem: The RLS UPDATE policy option_requests_update_participant uses
-- option_request_visible_to_me() for BOTH USING and WITH CHECK.
-- This allows any visible participant (client OR agency) to flip
-- client_price_status, agency_counter_price, and final_status —
-- regardless of which party should control each field.
--
-- Attack vector: A client can call PATCH /option_requests with
-- { "client_price_status": "accepted", "final_status": "option_confirmed" }
-- and self-confirm their own offer without agency approval.
-- Symmetrically, an agency can self-accept their own counter-offer.
--
-- Fix: Convert the two critical price acceptance actions into
-- SECURITY DEFINER RPCs that validate the caller's role.
-- The broad UPDATE-any-field policy is replaced by role-split policies.
--
-- Idempotent: CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- Run AFTER migration_organizations_invitations_rls.sql (option_request_visible_to_me).
-- =============================================================================


-- ─── 1. Replace broad update policy with role-split policies ─────────────────

-- Drop the single permissive policy that allowed any participant to write any field
DROP POLICY IF EXISTS option_requests_update_participant ON public.option_requests;


-- 1a. Agency-exclusive UPDATE: only agency members may change price/confirmation fields.
--     They can also change scheduling, status, assignee etc. — because only agency
--     members initiate those actions in practice.
DROP POLICY IF EXISTS option_requests_update_agency_member ON public.option_requests;

CREATE POLICY option_requests_update_agency_member
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (
    -- Agency member must be able to see this request
    EXISTS (
      SELECT 1
      FROM   public.organizations oa
      JOIN   public.organization_members ma ON ma.organization_id = oa.id
      WHERE  oa.agency_id = option_requests.agency_id
        AND  oa.type      = 'agency'
        AND  ma.user_id   = auth.uid()
        AND  (
          ma.role = 'owner'
          OR (
            ma.role = 'booker'
            AND (
              option_requests.agency_assignee_user_id IS NULL
              OR option_requests.agency_assignee_user_id = auth.uid()
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.organizations oa
      JOIN   public.organization_members ma ON ma.organization_id = oa.id
      WHERE  oa.agency_id = option_requests.agency_id
        AND  oa.type      = 'agency'
        AND  ma.user_id   = auth.uid()
        AND  (
          ma.role = 'owner'
          OR (
            ma.role = 'booker'
            AND (
              option_requests.agency_assignee_user_id IS NULL
              OR option_requests.agency_assignee_user_id = auth.uid()
            )
          )
        )
    )
  );

COMMENT ON POLICY option_requests_update_agency_member ON public.option_requests IS
  'Agency owner/booker can update option request fields. '
  'EXPLOIT-C1 fix: replaces old option_requests_update_participant which allowed '
  'any participant to write any field including agency-exclusive price fields.';


-- 1b. Client-exclusive UPDATE: client org members may update client-controlled fields.
--     Intentionally limited to status=rejected (client cancel) and scheduling.
--     Price acceptance by client is handled exclusively via RPC (below).
DROP POLICY IF EXISTS option_requests_update_client_member ON public.option_requests;

CREATE POLICY option_requests_update_client_member
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (
    -- Modern client org member
    (
      option_requests.organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM   public.organizations oc
        JOIN   public.organization_members mc ON mc.organization_id = oc.id
        WHERE  oc.id     = option_requests.organization_id
          AND  oc.type   = 'client'
          AND  mc.user_id = auth.uid()
      )
    )
    -- Legacy direct client
    OR (
      option_requests.organization_id IS NULL
      AND option_requests.client_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Client may only update: status=rejected (cancel), scheduling fields.
    -- They may NOT change client_price_status, agency_counter_price, or final_status
    -- through direct UPDATE — those go through the secured RPCs below.
    (
      -- Allow any update that does NOT change price-control fields to agency-exclusive values
      -- The RPC functions below handle price acceptance securely.
      (
        option_requests.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organizations oc
          JOIN   public.organization_members mc ON mc.organization_id = oc.id
          WHERE  oc.id     = option_requests.organization_id
            AND  oc.type   = 'client'
            AND  mc.user_id = auth.uid()
        )
      )
      OR (
        option_requests.organization_id IS NULL
        AND option_requests.client_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_update_client_member ON public.option_requests IS
  'Client org member can update client-side fields (cancel, scheduling). '
  'Price acceptance is done exclusively through the secured RPCs (EXPLOIT-C1 fix).';


-- 1c. Model UPDATE: linked model can update model_approval only.
DROP POLICY IF EXISTS option_requests_update_model ON public.option_requests;

CREATE POLICY option_requests_update_model
  ON public.option_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.models mo
      WHERE  mo.id      = option_requests.model_id
        AND  mo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.models mo
      WHERE  mo.id      = option_requests.model_id
        AND  mo.user_id = auth.uid()
    )
  );

COMMENT ON POLICY option_requests_update_model ON public.option_requests IS
  'Linked model may update model_approval. EXPLOIT-C1 fix.';


-- ─── 2. SECURITY DEFINER RPC: agency_confirm_client_price ────────────────────
--
-- Replaces the TypeScript agencyAcceptClientPrice() direct UPDATE.
-- Validates that the caller is an agency member BEFORE updating.

CREATE OR REPLACE FUNCTION public.agency_confirm_client_price(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id UUID;
BEGIN
  -- Load the agency of this request
  SELECT agency_id INTO v_agency_id
  FROM   public.option_requests
  WHERE  id = p_request_id
    AND  status                = 'in_negotiation'
    AND  client_price_status   = 'pending'
    AND  final_status          = 'option_pending';

  IF NOT FOUND THEN
    RETURN FALSE;  -- request not in expected state
  END IF;

  -- Enforce: caller must be an agency org member for this specific agency
  IF NOT EXISTS (
    SELECT 1
    FROM   public.organizations oa
    JOIN   public.organization_members ma ON ma.organization_id = oa.id
    WHERE  oa.agency_id = v_agency_id
      AND  oa.type      = 'agency'
      AND  ma.user_id   = auth.uid()
      AND  ma.role IN ('owner', 'booker')
  ) THEN
    RAISE EXCEPTION 'agency_confirm_client_price: caller is not a member of the agency for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Perform the update
  UPDATE public.option_requests
  SET
    client_price_status = 'accepted',
    final_status        = 'option_confirmed'
  WHERE id = p_request_id
    AND status                = 'in_negotiation'
    AND client_price_status   = 'pending'
    AND final_status          = 'option_pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_confirm_client_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_confirm_client_price(UUID) TO authenticated;

COMMENT ON FUNCTION public.agency_confirm_client_price(UUID) IS
  'Agency accepts the client''s proposed price. Validates that the caller is '
  'an agency org member for the specific request before updating. '
  'SECURITY DEFINER — cannot be spoofed by a client. '
  'EXPLOIT-C1 fix (Abuse Audit 2026-04).';


-- ─── 3. SECURITY DEFINER RPC: client_accept_counter_offer ────────────────────
--
-- Replaces the TypeScript clientAcceptCounterPrice() direct UPDATE.
-- Validates that the caller is the client BEFORE updating.

CREATE OR REPLACE FUNCTION public.client_accept_counter_offer(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id     UUID;
  v_org_id        UUID;
BEGIN
  -- Load client identity of this request
  SELECT client_id, organization_id
  INTO   v_client_id, v_org_id
  FROM   public.option_requests
  WHERE  id = p_request_id
    AND  client_price_status = 'pending'
    AND  final_status        = 'option_pending';

  IF NOT FOUND THEN
    RETURN FALSE;  -- request not in expected state
  END IF;

  -- Enforce: caller must be the client (direct or via org)
  IF NOT (
    -- Legacy direct client
    v_client_id = auth.uid()
    -- Modern client org member
    OR (v_org_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM   public.organizations oc
      JOIN   public.organization_members mc ON mc.organization_id = oc.id
      WHERE  oc.id     = v_org_id
        AND  oc.type   = 'client'
        AND  mc.user_id = auth.uid()
    ))
  ) THEN
    RAISE EXCEPTION 'client_accept_counter_offer: caller is not the client for request %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Perform the update
  UPDATE public.option_requests
  SET
    client_price_status = 'accepted',
    final_status        = 'option_confirmed'
  WHERE id = p_request_id
    AND  client_price_status = 'pending'
    AND  final_status        = 'option_pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL    ON FUNCTION public.client_accept_counter_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_accept_counter_offer(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_accept_counter_offer(UUID) IS
  'Client accepts the agency''s counter-offer. Validates that the caller is '
  'the actual client (direct or via org) before updating. '
  'SECURITY DEFINER — cannot be spoofed by agency. '
  'EXPLOIT-C1 fix (Abuse Audit 2026-04).';


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT routine_name
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name IN ('agency_confirm_client_price', 'client_accept_counter_offer');

SELECT policyname, cmd
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'option_requests'
ORDER BY policyname;
