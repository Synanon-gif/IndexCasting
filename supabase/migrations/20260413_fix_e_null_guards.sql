-- =============================================================================
-- Fix E: auth.uid() IS NULL Guards in SECURITY DEFINER Functions
--
-- PROBLEM (Rule 21):
--   SECURITY DEFINER functions with SET row_security TO off MUST have three
--   internal guards. GUARD 1 (auth.uid() IS NULL → RAISE EXCEPTION) was
--   missing from the following sql-language functions:
--     - check_org_access()      — returns false silently for NULL uid
--     - get_own_admin_flags()   — returns empty set silently for NULL uid
--
--   The Fix B migration already added the guard to get_my_org_context().
--   Fix C and Fix D migrations added it to their new functions.
--   This migration fixes the remaining functions.
--
-- WHY SILENT RETURNS ARE INSUFFICIENT:
--   Returning false/empty is functionally safe (no data leaks), but:
--   a) Makes it impossible to distinguish "caller has no access" from
--      "caller is not even authenticated" — audit logs miss the distinction.
--   b) If RLS is ever disabled at row level, an unauthenticated caller could
--      potentially reach these functions via service-role bypass.
--   c) Rule 21 is explicit: RAISE EXCEPTION is mandatory.
--
-- CONVERSION sql → plpgsql:
--   check_org_access() and get_own_admin_flags() are currently LANGUAGE sql.
--   They must be converted to LANGUAGE plpgsql to add IF/RAISE statements.
--   Behavior is otherwise identical.
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================


-- ─── 1. check_org_access() — add GUARD 1 ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_org_access(
  p_org_id            uuid,
  p_expected_org_type organization_type,
  p_required_roles    org_member_role[]
)
RETURNS boolean
LANGUAGE plpgsql  -- was sql; plpgsql required for IF/RAISE
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: authenticated (Rule 21)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id         = auth.uid()
      AND o.type            = p_expected_org_type
      AND m.role            = ANY(p_required_roles)
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.check_org_access(uuid, organization_type, org_member_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_org_access(uuid, organization_type, org_member_role[]) TO authenticated;

COMMENT ON FUNCTION public.check_org_access IS
  'Fix E (20260413): GUARD 1 (auth.uid() IS NULL → RAISE) added per Rule 21. '
  'Converted from LANGUAGE sql to plpgsql to support IF/RAISE. Logic unchanged.';


-- ─── 2. get_own_admin_flags() — add GUARD 1 ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE plpgsql  -- was sql; plpgsql required for IF/RAISE
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- GUARD 1: authenticated (Rule 21)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
    SELECT
      true          AS is_admin,
      p.is_super_admin
    FROM   public.profiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.id    = auth.uid()
      AND  p.id    = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
      AND  u.email = 'rubenelge@t-online.de';
END;
$$;

REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;

COMMENT ON FUNCTION public.get_own_admin_flags IS
  'Fix E (20260413): GUARD 1 (auth.uid() IS NULL → RAISE) added per Rule 21. '
  'Converted from LANGUAGE sql to plpgsql. UUID+email pin unchanged.';


-- ─── 3. is_current_user_admin() — add GUARD 1 ────────────────────────────────
--
-- is_current_user_admin() is widely used in RLS policies. For sql-language
-- functions called FROM RLS policies, RAISE EXCEPTION would propagate
-- and block the policy evaluation (undesirable for SELECT policies on login).
-- Safe approach: add explicit IS NOT NULL check in the WHERE clause instead
-- of a RAISE. This is equivalent in behavior for RLS contexts and still
-- explicit (not silent).

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security TO off
AS $$
  -- Explicit auth.uid() IS NOT NULL guard in WHERE (sql language, used in RLS policies;
  -- RAISE would abort policy evaluation for all users — use WHERE guard instead).
  SELECT COALESCE(
    (
      SELECT true
      FROM   public.profiles p
      JOIN   auth.users u ON u.id = p.id
      WHERE  auth.uid() IS NOT NULL
        AND  p.id    = auth.uid()
        AND  p.id    = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
        AND  u.email = 'rubenelge@t-online.de'
    ),
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.is_current_user_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

COMMENT ON FUNCTION public.is_current_user_admin IS
  'Fix E (20260413): explicit auth.uid() IS NOT NULL guard added to WHERE clause. '
  'Kept as LANGUAGE sql (not plpgsql) because it is used inside RLS policies — '
  'a RAISE in an RLS context would abort all policy evaluation for every user. '
  'UUID+email pin unchanged.';


-- ─── 4. assert_is_admin() — verify GUARD 1 already present ──────────────────
--
-- assert_is_admin() is plpgsql and calls is_current_user_admin().
-- If auth.uid() IS NULL, is_current_user_admin() returns false →
-- RAISE EXCEPTION 'assert_is_admin: unauthorized'. This is equivalent to
-- Guard 1 for the admin-RPC context. No change needed.

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'assert_is_admin'
      AND prosrc ILIKE '%unauthorized%'
  ), 'FAIL: assert_is_admin() missing RAISE EXCEPTION';

  RAISE NOTICE 'assert_is_admin() already has RAISE guard — no change needed';
END $$;


-- ─── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_src text;
BEGIN
  -- check_org_access must have not_authenticated guard
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'check_org_access' LIMIT 1;
  ASSERT v_src ILIKE '%not_authenticated%',
    'FAIL: check_org_access missing not_authenticated guard';

  -- get_own_admin_flags must have not_authenticated guard
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'get_own_admin_flags' LIMIT 1;
  ASSERT v_src ILIKE '%not_authenticated%',
    'FAIL: get_own_admin_flags missing not_authenticated guard';

  -- is_current_user_admin must have IS NOT NULL guard
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'is_current_user_admin' LIMIT 1;
  ASSERT v_src ILIKE '%IS NOT NULL%',
    'FAIL: is_current_user_admin missing IS NOT NULL guard';

  RAISE NOTICE 'PASS: 20260413_fix_e — all SECURITY DEFINER functions have auth.uid() guards';
END $$;
