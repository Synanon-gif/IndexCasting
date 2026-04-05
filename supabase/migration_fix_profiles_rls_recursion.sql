-- ============================================================================
-- Fix: Infinite RLS recursion on profiles (42P17)
-- Date: 2026-04-05
--
-- Root cause: Two recursion paths prevent ANY SELECT on profiles:
--
-- Path 1 (cross-table): profiles -> profiles_org_scoped_read -> models
--   subquery -> "Clients can read represented visible models" policy
--   -> SELECT FROM profiles -> RLS on profiles again -> RECURSION
--
-- Path 2 (function-based): profiles -> admin_select_all_profiles
--   -> is_current_user_admin() -> SELECT FROM profiles (SECURITY DEFINER
--   but NO row_security=off) -> RLS applies in PG15+ -> RECURSION
--
-- Fix:
--   1. Add SET row_security TO off to all admin helper functions
--      (matches the pattern already used by user_is_member_of_organization)
--   2. Remove direct profiles reference from the models client-read policy
--
-- Security: UUID+email-pinning and SECURITY DEFINER remain unchanged.
-- row_security=off only affects the INTERNAL query of each function, not
-- the caller's context.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── 1. Fix is_current_user_admin() — add SET row_security TO off ────────────

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT COALESCE(
    (
      SELECT true
      FROM   public.profiles p
      JOIN   auth.users u ON u.id = p.id
      WHERE  p.id    = auth.uid()
        AND  p.id    = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
        AND  u.email = 'rubenelge@t-online.de'
    ),
    false
  );
$$;

ALTER FUNCTION public.is_current_user_admin() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.is_current_user_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ── 2. Fix is_current_user_super_admin() — add SET row_security TO off ──────

CREATE OR REPLACE FUNCTION public.is_current_user_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT COALESCE(
    (
      SELECT p.is_super_admin
      FROM   public.profiles p
      JOIN   auth.users u ON u.id = p.id
      WHERE  p.id        = auth.uid()
        AND  p.id        = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
        AND  u.email     = 'rubenelge@t-online.de'
    ),
    false
  );
$$;

ALTER FUNCTION public.is_current_user_super_admin() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.is_current_user_super_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_super_admin() TO authenticated;

-- ── 3. Fix get_own_admin_flags() — add SET row_security TO off ──────────────

CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT
    true          AS is_admin,
    p.is_super_admin
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id    = auth.uid()
    AND  p.id    = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
    AND  u.email = 'rubenelge@t-online.de';
$$;

ALTER FUNCTION public.get_own_admin_flags() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;

-- ── 4. Fix models "Clients can read represented visible models" policy ──────
--
-- Remove the direct profiles reference that causes cross-table recursion:
--   profiles -> models -> profiles
--
-- The two remaining client-detection clauses (via organizations +
-- organization_members) cover the same use case without touching profiles.

DROP POLICY IF EXISTS "Clients can read represented visible models" ON public.models;

CREATE POLICY "Clients can read represented visible models"
  ON public.models
  FOR SELECT
  TO authenticated
  USING (
    has_platform_access()
    AND (
      EXISTS (
        SELECT 1
        FROM   public.organizations o
        JOIN   public.organization_members om ON om.organization_id = o.id
        WHERE  o.type = 'client'::organization_type
          AND  om.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM   public.organizations o
        WHERE  o.type = 'client'::organization_type
          AND  o.owner_id = auth.uid()
      )
    )
    AND (is_visible_commercial = true OR is_visible_fashion = true)
    AND (
      country_code IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM   public.model_agency_territories mat
        WHERE  mat.model_id = models.id
      )
    )
  );

-- ── 5. Verification queries (run after deploy) ─────────────────────────────
--
-- Check function configs:
--   SELECT proname, array_to_string(proconfig, ',') as config
--   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
--   WHERE n.nspname = 'public'
--     AND proname IN ('is_current_user_admin', 'is_current_user_super_admin',
--                     'get_own_admin_flags', 'user_is_member_of_organization');
--   → all four should show row_security=off
--
-- Check models policy no longer references profiles:
--   SELECT qual FROM pg_policies
--   WHERE tablename = 'models'
--     AND policyname = 'Clients can read represented visible models';
--   → qual should NOT contain 'profiles'
--
-- Check profiles query works:
--   SELECT id, display_name FROM profiles WHERE id = auth.uid();
--   → should return 1 row, no 42P17 error
-- ============================================================================
