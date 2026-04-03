-- EXPLOIT-M5 Fix: Admin privilege escalation hardening
--
-- Problem: isCurrentUserAdmin() only reads profiles.is_admin client-side.
-- If profiles.is_admin can be written by a non-admin (e.g. via authenticated
-- RLS UPDATE on their own profile row), it's a full privilege escalation path.
--
-- This migration:
--   1. Creates assert_is_admin() helper for shared use across admin RPCs.
--   2. Adds a trg_prevent_is_admin_escalation trigger that blocks non-admin
--      users from setting profiles.is_admin = true on their own row.
--   3. Ensures admin_purge_user_data() calls assert_is_admin().
--   4. Adds an audit INSERT into admin_logs whenever is_admin changes.


-- =============================================================================
-- 1. assert_is_admin() helper — shared by all admin RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_is_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT is_admin INTO v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Forbidden: caller is not a platform admin'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_is_admin() TO authenticated;

COMMENT ON FUNCTION public.assert_is_admin() IS
  'EXPLOIT-M5 fix: shared admin guard — raises 42501 if caller is not is_admin. '
  'Used by all SECURITY DEFINER admin RPCs to enforce is_admin at DB level.';


-- =============================================================================
-- 2. Trigger: prevent non-admin users from escalating is_admin on their own row
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_prevent_is_admin_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_is_admin boolean;
BEGIN
  -- Only fire when is_admin is actually changing.
  IF NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin THEN
    RETURN NEW;
  END IF;

  -- Check if the caller is already an admin.
  SELECT is_admin INTO v_caller_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT COALESCE(v_caller_is_admin, false) THEN
    RAISE EXCEPTION
      'Forbidden: only existing admins may change the is_admin flag'
      USING ERRCODE = '42501';
  END IF;

  -- Audit: log the is_admin change for super-admin review.
  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (
    auth.uid(),
    CASE WHEN NEW.is_admin THEN 'grant_admin' ELSE 'revoke_admin' END,
    NEW.id,
    jsonb_build_object(
      'old_is_admin', OLD.is_admin,
      'new_is_admin', NEW.is_admin
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_prevent_is_admin_escalation() IS
  'EXPLOIT-M5 fix: blocks non-admin users from writing is_admin = true on their '
  'own profile row; logs every is_admin state change to admin_logs.';

DROP TRIGGER IF EXISTS trg_prevent_is_admin_escalation ON public.profiles;

CREATE TRIGGER trg_prevent_is_admin_escalation
  BEFORE UPDATE OF is_admin
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_is_admin_escalation();

COMMENT ON TRIGGER trg_prevent_is_admin_escalation ON public.profiles IS
  'EXPLOIT-M5 fix: prevents privilege escalation via self-update of is_admin.';


-- =============================================================================
-- 3. Patch admin_purge_user_data to call assert_is_admin()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(target_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- EXPLOIT-M5 fix: explicit is_admin check before destructive operation.
  PERFORM public.assert_is_admin();

  -- Soft-delete the profile (cascade handles related rows per schema).
  DELETE FROM public.profiles WHERE id = target_id;

  INSERT INTO public.admin_logs (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_purge_user_data', target_id, '{}');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_purge_user_data(UUID) IS
  'EXPLOIT-M5 fix: Admin only (assert_is_admin). '
  'Deletes profile + all CASCADE rows. '
  'Call auth.admin.deleteUser(target_id) from Edge Function to purge auth record.';


-- =============================================================================
-- 4. Verify the trigger is live
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name   = 'trg_prevent_is_admin_escalation'
      AND event_object_table = 'profiles'
  ) THEN
    RAISE EXCEPTION 'trg_prevent_is_admin_escalation was not created';
  END IF;
END $$;
