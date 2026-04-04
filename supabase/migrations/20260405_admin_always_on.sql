-- ============================================================================
-- Admin Always-On — 2026-04-05
--
-- Ensures the platform admin ALWAYS has access to all admin functions,
-- regardless of column-level REVOKEs or RLS edge cases.
--
-- Changes:
-- 1. `is_current_user_admin()` — inline helper (SECURITY DEFINER) used by
--    all admin RLS policies instead of direct `profiles.is_admin` reads.
--    This makes admin access immune to column-level REVOKE, future schema
--    changes, and any other grant/revoke drift.
--
-- 2. Rebuilds all admin-gated RLS policies to call
--    `is_current_user_admin()` / `is_current_user_super_admin()` instead
--    of embedding the subquery directly.
--
-- 3. Ensures admin_logs INSERT is only possible for platform admins
--    (was previously open to any authenticated user).
-- ============================================================================

-- ── 1. Helper functions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.is_current_user_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_current_user_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_super_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.is_current_user_super_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_super_admin() TO authenticated;

-- ── 2. Rebuild admin-gated RLS policies ──────────────────────────────────────

-- ── admin_logs ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_logs_insert"          ON public.admin_logs;
DROP POLICY IF EXISTS "super_admin_logs_select"    ON public.admin_logs;

-- INSERT: only platform admins may write audit log entries
CREATE POLICY "admin_logs_insert"
  ON public.admin_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin());

-- SELECT: only super-admins may read audit logs
CREATE POLICY "super_admin_logs_select"
  ON public.admin_logs
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_super_admin());

-- ── admin_overrides ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_overrides"         ON public.admin_overrides;

CREATE POLICY "admin_select_overrides"
  ON public.admin_overrides
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- ── agency_usage_limits ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_full_access_usage_limits" ON public.agency_usage_limits;

CREATE POLICY "admin_full_access_usage_limits"
  ON public.agency_usage_limits
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ── organization_members ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_org_members"   ON public.organization_members;

CREATE POLICY "admin_select_all_org_members"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- ── organizations ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_select_all_organizations" ON public.organizations;
DROP POLICY IF EXISTS "admin_update_org_all"           ON public.organizations;

CREATE POLICY "admin_select_all_organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "admin_update_org_all"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ── 3. Verify admin profile is always readable by own user ───────────────────
-- The profiles_org_scoped_read policy already covers id = auth.uid(), so the
-- admin can always read their own profile. No change needed here.
-- ============================================================================
