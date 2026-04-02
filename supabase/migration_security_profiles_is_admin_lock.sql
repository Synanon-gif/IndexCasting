-- =============================================================================
-- CRIT-02: Lock profiles.is_admin and profiles.role against direct manipulation
--
-- Problem: The "Users can update own profile" RLS policy allows UPDATE with
-- only USING (id = auth.uid()) — no column-level restriction. This means any
-- authenticated user can set is_admin = true on their own profile row via a
-- direct Supabase client call, granting full admin access.
--
-- Fix (two layers):
--   1. REVOKE column-level UPDATE privileges for is_admin and role from
--      authenticated. The role column may be set during initial signup via
--      service_role (Edge Function / trigger) but must not be writable
--      by end-users afterwards.
--   2. BEFORE UPDATE trigger that blocks any change to is_admin by the
--      calling user when executed as authenticated (i.e. not service_role).
--      This is the belt-and-suspenders guard: even if column-level REVOKE
--      is somehow bypassed (e.g. via a future broad GRANT), the trigger fires.
--
-- After this migration:
--   - Normal users can still update display_name, avatar_url, bio, etc.
--   - is_admin can only be set via service_role (Edge Functions, DB admin).
--   - role can only be set via service_role (initial signup bootstrap).
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

-- ─── 1. Column-level REVOKE ───────────────────────────────────────────────────
-- Remove UPDATE permission on sensitive columns from the authenticated role.
-- service_role bypasses RLS and retains full access.

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated;
REVOKE UPDATE (role)     ON public.profiles FROM authenticated;

-- ─── 2. BEFORE UPDATE trigger — belt-and-suspenders ──────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation_on_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block any attempt to elevate is_admin via a non-service-role session.
  -- current_user = 'authenticator' when called through PostgREST (anon/authenticated).
  -- current_user = 'supabase_admin' / 'postgres' for service_role & migrations.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION
      'privilege_escalation_blocked: is_admin cannot be changed by authenticated users';
  END IF;

  -- Block direct role changes (agent, client, model, admin) by non-service sessions.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION
      'privilege_escalation_blocked: role cannot be changed by authenticated users';
  END IF;

  RETURN NEW;
END;
$$;

-- Revoke public execute — this is a trigger function, not a callable RPC.
REVOKE ALL ON FUNCTION public.prevent_privilege_escalation_on_profiles() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_privilege_escalation
  BEFORE UPDATE OF is_admin, role
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_privilege_escalation_on_profiles();

-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm the trigger exists:
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'profiles'
--   AND trigger_name = 'trg_prevent_privilege_escalation';
--
-- Confirm column privilege is revoked (should not include 'UPDATE' for authenticated):
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'profiles'
--   AND column_name IN ('is_admin', 'role')
--   AND grantee = 'authenticated';
