-- ============================================================================
-- Admin Final Fix — 2026-04-07
--
-- Fixes four overlapping bugs that prevent admin login:
--
-- Bug 1: trg_prevent_privilege_escalation has no current_user check — it
--   blocks ALL updates to is_admin, including postgres/service_role sessions
--   used by Supabase Management API migrations. Result: is_admin was NEVER
--   set to true for the admin user despite being needed.
--
-- Bug 2: get_own_admin_flags() reads p.is_admin from the DB — returns false
--   because p.is_admin is false. UUID+email match should be sufficient truth.
--
-- Bug 3: REVOKE SELECT (role) from 20260406_admin_uuid_email_hardening.sql
--   was supposed to be restored by 20260406_admin_profile_visibility_fix.sql,
--   but alphabetically (p < u) the visibility_fix runs first on CLI deploys,
--   leaving role revoked and breaking the PROFILE_FIELDS query for all users.
--   Also revoked: email, phone — also in PROFILE_FIELDS.
--
-- Bug 4: profiles.role has no CHECK constraint — any string value can enter.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── 1. Fix trigger: add current_user check so postgres/supabase_admin ────────
--    (Supabase Management API context) can still update is_admin via migration.
--    authenticator = PostgREST role used for ALL app-side requests → still blocked.
--    This mirrors exactly how migration_super_admin_2026_04.sql sets is_super_admin
--    before re-locking the trigger.

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation_on_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow: postgres, supabase_admin, supabase_auth_admin (migration / service-role contexts).
  -- Block: authenticator (PostgREST — all normal app requests, anon + authenticated).
  IF current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION
      'privilege_escalation_blocked: is_admin cannot be changed by authenticated users';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION
      'privilege_escalation_blocked: role cannot be changed by authenticated users';
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION
      'privilege_escalation_blocked: is_super_admin cannot be changed by authenticated users';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_privilege_escalation_on_profiles() FROM PUBLIC;

-- Recreate trigger (covers all three protected columns)
DROP TRIGGER IF EXISTS trg_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_privilege_escalation
  BEFORE UPDATE OF is_admin, role, is_super_admin
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_privilege_escalation_on_profiles();

-- ── 2. Set is_admin = true and role = 'admin' for platform admin ──────────────
--    Now safe: trigger allows postgres (the current session via Management API).
--    is_super_admin was already set to true in migration_super_admin_2026_04.sql.

UPDATE public.profiles
SET
  is_admin      = true,
  role          = 'admin',
  is_active     = true
WHERE id = 'fb0ab854-d0c3-4e09-a39c-269d60246927';

-- ── 3. Fix get_own_admin_flags() — return true based on UUID+email match ──────
--    Previous version returned p.is_admin from DB (was false → returned false).
--    UUID+email pin IS the authoritative identity check; no need to also read
--    p.is_admin when the identity is already proven by auth.users.email match.

CREATE OR REPLACE FUNCTION public.get_own_admin_flags()
RETURNS TABLE(is_admin boolean, is_super_admin boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    true          AS is_admin,          -- UUID+email match = identity proven
    p.is_super_admin
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id    = auth.uid()
    AND  p.id    = 'fb0ab854-d0c3-4e09-a39c-269d60246927'
    AND  u.email = 'rubenelge@t-online.de';
$$;

REVOKE ALL    ON FUNCTION public.get_own_admin_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_own_admin_flags() TO authenticated;

-- ── 4. Fix is_current_user_admin() — same hardening as get_own_admin_flags ───
--    Returns true whenever UUID+email match, regardless of p.is_admin DB value.

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
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

REVOKE ALL    ON FUNCTION public.is_current_user_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ── 5. Restore column-level SELECT grants (idempotent) ───────────────────────
--    20260406_admin_uuid_email_hardening.sql revoked SELECT (role).
--    20260405_profiles_policy_canonical.sql revoked SELECT (email, phone).
--    PROFILE_FIELDS in AuthContext.tsx reads all three — without them the
--    profile query fails for EVERY user (not just admin).
--    GRANT is idempotent: safe to run even if already granted.

GRANT SELECT (role)  ON public.profiles TO authenticated;
GRANT SELECT (email) ON public.profiles TO authenticated;
GRANT SELECT (phone) ON public.profiles TO authenticated;

-- ── 6. Add CHECK constraint on profiles.role ──────────────────────────────────
--    Prevents invalid roles from entering the DB.
--    Existing rows with role IN this list are unaffected.
--    Use NOT VALID + VALIDATE separately to avoid full table scan locking in prod.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_profile_role;

ALTER TABLE public.profiles
  ADD CONSTRAINT chk_profile_role
  CHECK (role IN ('admin', 'model', 'agent', 'client', 'guest'))
  NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT chk_profile_role;

-- ── 7. Verification queries (run manually to confirm) ────────────────────────
-- Admin profile:
--   SELECT id, role, is_admin, is_super_admin, is_active
--   FROM profiles WHERE id = 'fb0ab854-d0c3-4e09-a39c-269d60246927';
--   → role='admin', is_admin=true, is_super_admin=true, is_active=true
--
-- Column grants restored:
--   SELECT grantee, privilege_type, column_name
--   FROM information_schema.column_privileges
--   WHERE table_name = 'profiles'
--     AND column_name IN ('role', 'email', 'phone')
--     AND grantee = 'authenticated';
--   → should show SELECT for all three
--
-- get_own_admin_flags() (run as admin user):
--   SELECT * FROM get_own_admin_flags();
--   → {is_admin: true, is_super_admin: true}
--
-- Trigger still blocks app-side escalation:
--   As authenticated user, attempt: UPDATE profiles SET is_admin = true WHERE id = auth.uid();
--   → ERROR: privilege_escalation_blocked
-- ============================================================================
