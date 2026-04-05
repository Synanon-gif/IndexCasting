-- =============================================================================
-- Fix: model_assignments ↔ models RLS-Rekursion (42P17)
-- Date: 2026-04-05
--
-- Root cause:
--   models SELECT ("Clients can read represented visible models")
--     → EXISTS on model_assignments
--     → model_assignments SELECT ("model_assignments_select_org_scoped")
--       → EXISTS on models (m.user_id = auth.uid())
--       → models SELECT RLS re-evaluated → 42P17 INFINITE RECURSION
--
-- Fix strategy:
--   1. New SECURITY DEFINER helper model_belongs_to_current_user()
--      with SET row_security TO off — bypasses models RLS.
--   2. Replace the direct models subquery in model_assignments policy
--      with a call to the helper function.
--   3. Harden check_org_access() with SET row_security TO off
--      (latent recursion: org_members_select → check_org_access → org_members).
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper: model_belongs_to_current_user(uuid)
--    Checks models.user_id = auth.uid() WITHOUT triggering models RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.model_belongs_to_current_user(p_model_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.models
    WHERE id = p_model_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.model_belongs_to_current_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.model_belongs_to_current_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Recreate model_assignments_select_org_scoped
--    Replace direct models subquery with function call.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "model_assignments_select_org_scoped" ON public.model_assignments;

CREATE POLICY "model_assignments_select_org_scoped"
  ON public.model_assignments FOR SELECT
  TO authenticated
  USING (
    organization_id = ANY(public.get_my_organization_ids())
    OR public.model_belongs_to_current_user(model_id)
  );

-- ---------------------------------------------------------------------------
-- 3) Harden check_org_access: add SET row_security TO off
--    Prevents latent recursion: org_members_select policy calls
--    check_org_access, which queries organization_members.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_org_access(
  p_org_id uuid,
  p_expected_org_type organization_type,
  p_required_roles org_member_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id         = auth.uid()
      AND o.type            = p_expected_org_type
      AND m.role            = ANY(p_required_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4) Verification
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Verify model_belongs_to_current_user exists
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'model_belongs_to_current_user'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ), 'model_belongs_to_current_user() not found';

  -- Verify the function has row_security=off
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'model_belongs_to_current_user'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prosecdef = true
      AND 'row_security=off' = ANY(proconfig)
  ), 'model_belongs_to_current_user() missing SECURITY DEFINER or row_security=off';

  -- Verify the policy exists and does NOT reference models directly
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'model_assignments'
      AND policyname = 'model_assignments_select_org_scoped'
  ), 'model_assignments_select_org_scoped policy not found';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'model_assignments'
      AND policyname = 'model_assignments_select_org_scoped'
      AND qual::text ILIKE '%FROM public.models%'
  ), 'model_assignments_select_org_scoped still references models directly — recursion not fixed!';

  -- Verify check_org_access has row_security=off
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'check_org_access'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prosecdef = true
      AND 'row_security=off' = ANY(proconfig)
  ), 'check_org_access() missing row_security=off';

  RAISE NOTICE 'migration_fix_model_assignments_rls_recursion: ALL OK — recursion fixed';
END $$;
