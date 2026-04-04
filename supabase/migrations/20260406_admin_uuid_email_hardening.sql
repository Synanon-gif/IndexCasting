-- ============================================================================
-- Admin UUID + Email Hardening — 2026-04-06
--
-- Goal: Nobody can impersonate the platform admin.
--       Admin access is locked to ONE specific UUID AND email address.
--       Three independent layers must ALL pass simultaneously:
--         1. auth.uid() = ADMIN_UUID            (identity, set by Supabase auth)
--         2. auth.users.email = ADMIN_EMAIL      (verified email, set by Supabase)
--         3. profiles.is_admin = true            (explicit flag, trigger-protected)
--
-- Changes:
--   1. UUID+Email-pin is_current_user_admin()
--   2. UUID+Email-pin is_current_user_super_admin()
--   3. UUID+Email-pin get_own_admin_flags()
--   4. admin_access_attempts table + log_failed_admin_attempt() SECURITY DEFINER
--   5. Revoke role='admin' bypass: REVOKE SELECT (role) from authenticated
--      so the client-side fallback can no longer read it.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── 1. UUID+Email-pin is_current_user_admin() ────────────────────────────────
--
-- Was: only checked profiles.is_admin for auth.uid()
-- Now: ALSO requires uuid = ADMIN_UUID AND email = ADMIN_EMAIL in auth.users.
--      All three conditions must be true simultaneously.

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.is_admin
      FROM   public.profiles p
      JOIN   auth.users u ON u.id = p.id
      WHERE  p.id        = auth.uid()
        AND  p.id        = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
        AND  u.email     = 'rubenelge@t-online.de'
    ),
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.is_current_user_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ── 2. UUID+Email-pin is_current_user_super_admin() ──────────────────────────

CREATE OR REPLACE FUNCTION public.is_current_user_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
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

REVOKE ALL    ON FUNCTION public.is_current_user_super_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_super_admin() TO authenticated;

-- ── 3. UUID+Email-pin get_own_admin_flags() ───────────────────────────────────
--
-- Called by AuthContext and adminSupabase.ts as the primary admin check.
-- Returns empty set (no rows) if ANY of the three conditions fails.

CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.is_admin, p.is_super_admin
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id        = auth.uid()
    AND  p.id        = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
    AND  u.email     = 'rubenelge@t-online.de';
$$;

REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;

-- ── 4. Revoke SELECT on role column from authenticated ────────────────────────
--
-- The client-side fallback `role === 'admin'` reads the role column.
-- Revoking SELECT on role prevents this bypass path entirely.
-- Legitimate role checks happen via SECURITY DEFINER RPCs (get_my_org_role, etc.).

REVOKE SELECT (role) ON public.profiles FROM authenticated;

-- ── 5. Admin intrusion detection table ───────────────────────────────────────
--
-- Logs every attempt to call admin RPCs that fails the UUID/email/is_admin gate.
-- Visible only to the super-admin. Cannot be written by regular authenticated users
-- (INSERT goes through SECURITY DEFINER only).

CREATE TABLE IF NOT EXISTS public.admin_access_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  action        text        NOT NULL,
  success       boolean     NOT NULL DEFAULT false,
  user_agent    text,
  notes         text
);

ALTER TABLE public.admin_access_attempts ENABLE ROW LEVEL SECURITY;

-- Only super-admin may read the intrusion log
DROP POLICY IF EXISTS "super_admin_read_access_attempts" ON public.admin_access_attempts;
CREATE POLICY "super_admin_read_access_attempts"
  ON public.admin_access_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_super_admin());

-- No authenticated INSERT — only via SECURITY DEFINER function below
REVOKE INSERT, UPDATE, DELETE ON public.admin_access_attempts FROM authenticated;
GRANT  SELECT                  ON public.admin_access_attempts TO authenticated;

-- ── 6. log_failed_admin_attempt() — SECURITY DEFINER inserter ────────────────
--
-- Called by admin RPCs when the caller fails the admin check.
-- Runs as the function owner (postgres/service_role) to bypass INSERT REVOKE.

CREATE OR REPLACE FUNCTION public.log_failed_admin_attempt(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_access_attempts (attempted_by, action, success)
  VALUES (auth.uid(), p_action, false);
EXCEPTION WHEN OTHERS THEN
  -- Never let intrusion logging block the actual error response.
  NULL;
END;
$$;

REVOKE ALL    ON FUNCTION public.log_failed_admin_attempt(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_failed_admin_attempt(text) TO authenticated;

-- ── 7. Harden assert_is_admin() to call UUID-pinned is_current_user_admin() ──
--
-- Replaces any prior version that used a direct subquery.

CREATE OR REPLACE FUNCTION public.assert_is_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    PERFORM public.log_failed_admin_attempt('assert_is_admin');
    RAISE EXCEPTION 'assert_is_admin: unauthorized – not the platform admin';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.assert_is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_is_admin() TO authenticated;

-- ── 8. Verification ───────────────────────────────────────────────────────────
-- After running, confirm functions exist with SECURITY DEFINER:
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'is_current_user_admin', 'is_current_user_super_admin',
--     'get_own_admin_flags', 'assert_is_admin', 'log_failed_admin_attempt'
--   );
--
-- Confirm role column is revoked:
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'profiles' AND column_name = 'role'
--   AND grantee = 'authenticated';
-- ============================================================================
