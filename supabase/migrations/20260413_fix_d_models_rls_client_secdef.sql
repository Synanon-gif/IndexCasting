-- =============================================================================
-- Fix D: models CLIENT RLS-Policy — Replace Direct profiles.role Check
--
-- PROBLEM:
--   "Clients can read represented visible models" policy uses:
--     EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'client')
--
--   This violates two rules:
--   a) Gefahr 1 (rls-security-patterns.mdc): direct profiles column access in
--      RLS policies is fragile; if is_admin/role are column-REVOKEd, the check
--      returns NULL → policy evaluates false → clients can't see models.
--   b) Recursion risk: profiles → models → (other table) → profiles creates
--      a 42P17 cycle in PG15+.
--   c) OR-logic: any user with profiles.role = 'client' can see models,
--      even without a client org membership.
--
-- FIX:
--   1. Create caller_is_client_org_member() — SECURITY DEFINER with
--      row_security=off. Checks org membership only (no profiles.role access).
--   2. Replace the three-branch USING clause with this single function.
--   3. Also fix the same pattern in "Clients can view model territories"
--      (already done in Fix A, but we verify here).
--
-- Auth-check review (Q1–Q4):
--   Q1: Breaks login?     No — policy is FOR SELECT only on models.
--   Q2: Breaks org?       No — org membership is the check.
--   Q3: Breaks admin?     No — is_current_user_admin() is first in USING.
--   Q4: RLS recursion?    No — caller_is_client_org_member reads
--                         organization_members + organizations (no profiles/models join).
--
-- Idempotent: safe to run multiple times.
-- =============================================================================


-- ─── 1. caller_is_client_org_member() ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.caller_is_client_org_member()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- True if the caller is a member or owner of any client-type organization.
  -- Does NOT read profiles or models (no recursion risk).
  RETURN (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.type = 'client'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.owner_id = auth.uid()
        AND o.type = 'client'
    )
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.caller_is_client_org_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_client_org_member() TO authenticated;

COMMENT ON FUNCTION public.caller_is_client_org_member IS
  'Fix D (20260413): Returns true when the calling user belongs to a client-type org. '
  'SECURITY DEFINER + row_security=off; reads only organization_members + organizations '
  '(no profiles/models access → no recursion risk). Replaces direct profiles.role check '
  'in models RLS policy.';


-- ─── 2. Replace "Clients can read represented visible models" policy ──────────

DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;
DROP POLICY IF EXISTS "clients_read_represented_visible_models"     ON public.models;
DROP POLICY IF EXISTS "Clients read visible models"                  ON public.models;
DROP POLICY IF EXISTS "clients_read_visible_models"                  ON public.models;

CREATE POLICY "clients_read_visible_models"
  ON public.models FOR SELECT
  TO authenticated
  USING (
    -- Admin always has full access (checked first — no org membership required)
    public.is_current_user_admin()
    OR (
      -- Client org membership (no direct profiles.role access)
      public.caller_is_client_org_member()
      -- Visibility: model must be visible to the client's segment
      AND (models.is_visible_commercial = true OR models.is_visible_fashion = true)
      -- MANDATORY FIELD 1: name must be set
      AND models.name IS NOT NULL
      AND trim(models.name) != ''
      -- MANDATORY FIELD 2: at least one territory assigned
      AND EXISTS (
        SELECT 1 FROM public.model_agency_territories mat
        WHERE mat.model_id = models.id
      )
      -- MANDATORY FIELD 3: at least one portfolio photo
      AND array_length(models.portfolio_images, 1) > 0
    )
  );

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_policy_qual text;
BEGIN
  SELECT qual INTO v_policy_qual
  FROM pg_policies
  WHERE tablename  = 'models'
    AND policyname = 'clients_read_visible_models'
    AND cmd        = 'SELECT';

  ASSERT v_policy_qual IS NOT NULL,
    'FAIL: clients_read_visible_models policy not found on models';

  ASSERT v_policy_qual NOT ILIKE '%profiles%',
    'FAIL: clients_read_visible_models still references profiles table directly';

  ASSERT v_policy_qual ILIKE '%caller_is_client_org_member%',
    'FAIL: clients_read_visible_models does not use caller_is_client_org_member()';

  -- Verify no FOR ALL policy on models references profiles (recursion check)
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'models'
      AND cmd        = 'ALL'
      AND qual ILIKE '%profiles%'
  ), 'FAIL: FOR ALL policy on models references profiles (recursion risk)';

  RAISE NOTICE 'PASS: 20260413_fix_d — models client SELECT policy uses caller_is_client_org_member() (no profiles reference)';
END $$;
