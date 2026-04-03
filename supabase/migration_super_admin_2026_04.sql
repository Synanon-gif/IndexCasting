-- =============================================================================
-- Super-Admin: Separate privilege tier for audit log ownership
--
-- Problem: admin_logs RLS policies currently check is_admin = true, meaning
-- any future admin could read or — if not restricted — tamper with audit logs.
-- The Super-Admin (platform owner) must be the sole identity able to read
-- admin_logs, making it impossible for any other admin to cover their tracks.
--
-- Solution:
--   1. Add is_super_admin BOOLEAN column to profiles (default false).
--   2. Lock it identically to is_admin:
--        - REVOKE UPDATE (is_super_admin) FROM authenticated
--        - Extend prevent_privilege_escalation_on_profiles trigger
--   3. Set is_super_admin = true for the platform owner (service_role only).
--   4. Replace admin_logs_select / admin_logs_insert policies so they require
--      is_super_admin = true instead of is_admin = true.
--
-- After this migration:
--   - Regular admins can perform all admin actions but CANNOT read audit logs.
--   - Only the Super-Admin (is_super_admin = true) can read admin_logs.
--   - SECURITY DEFINER RPCs still write to admin_logs internally (bypasses RLS),
--     so log writes from RPCs are unaffected.
--   - is_super_admin can only be set via service_role / DB migration — never by
--     any authenticated session including other super-admins.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================


-- ─── 1. Add is_super_admin column ─────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;


-- ─── 2. Grant Super-Admin BEFORE the trigger is extended ──────────────────────
--
-- The Supabase DB-query API runs via PostgREST (current_user = 'authenticator'),
-- which is blocked by the trigger once is_super_admin is in its BEFORE UPDATE OF
-- clause. We must SET the value first, while the trigger does not yet guard this
-- column.
--
-- UUID: fb0ab854-d0c3-4e09-a39c-269d60246927 (rubenelge@t-online.de)

UPDATE public.profiles
SET is_super_admin = true
WHERE id = 'fb0ab854-d0c3-4e09-a39c-269d60246927';


-- ─── 3. Column-level REVOKE — same as is_admin ────────────────────────────────

REVOKE UPDATE (is_super_admin) ON public.profiles FROM authenticated;


-- ─── 4. Extend privilege-escalation trigger to cover is_super_admin ───────────
--
-- Now that the correct value is already stored, the trigger locks future changes.

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation_on_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- current_user = 'authenticator' for all PostgREST (anon/authenticated) sessions.
  -- current_user = 'supabase_admin' / 'postgres' for service_role & direct migrations.

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

-- Recreate trigger to cover is_super_admin in the OF clause.
DROP TRIGGER IF EXISTS trg_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_privilege_escalation
  BEFORE UPDATE OF is_admin, role, is_super_admin
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_privilege_escalation_on_profiles();


-- ─── 5. Restrict admin_logs policies to is_super_admin only ───────────────────
--
-- Drop the existing policies created in migration_security_admin_override_audit_2026_04.sql
-- and replace them with super-admin-only equivalents.

DROP POLICY IF EXISTS "admin_logs_select"        ON public.admin_logs;
DROP POLICY IF EXISTS "admin_logs_insert"        ON public.admin_logs;
DROP POLICY IF EXISTS "super_admin_logs_select"  ON public.admin_logs;
DROP POLICY IF EXISTS "super_admin_logs_insert"  ON public.admin_logs;

-- Only the Super-Admin can read audit logs.
-- Regular admins can write but never read, so they cannot learn what is logged
-- and therefore cannot craft misleading entries to cover specific actions.
CREATE POLICY "super_admin_logs_select"
  ON public.admin_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = TRUE)
  );

-- Any admin can INSERT (needed for client-side writeAdminLog calls).
-- SECURITY DEFINER RPCs bypass RLS and write unconditionally — this policy only
-- covers direct table writes from admin tooling.
-- Note: allowing INSERT for all admins is safe because:
--   (a) Admins cannot READ the log, so they cannot see existing entries to mimic;
--   (b) All security-critical writes (bypass_paywall, set_org_plan) happen inside
--       SECURITY DEFINER functions that cannot be blocked from the client side.
CREATE POLICY "admin_logs_insert"
  ON public.admin_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- No UPDATE / DELETE policy — append-only for all roles.


-- ─── Verification ─────────────────────────────────────────────────────────────
-- Confirm super-admin is set:
-- SELECT id, email, is_admin, is_super_admin FROM public.profiles
-- JOIN auth.users ON auth.users.id = profiles.id
-- WHERE is_super_admin = true;
--
-- Confirm policies:
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'admin_logs' ORDER BY policyname;
--
-- Confirm trigger covers is_super_admin:
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'profiles'
--   AND trigger_name = 'trg_prevent_privilege_escalation';
