-- =============================================================================
-- Personal Account Deletion — available to ALL authenticated users.
--
-- Purpose: Allow non-owner agency/client members (bookers, employees) to
--   request deletion of their personal account without requiring owner status.
--   They are removed from organization_members, and their profile is soft-deleted
--   (deletion_requested_at = now()). The existing 30-day purge cron picks this up.
--
-- Contrast with request_account_deletion (migration_account_deletion_owner_only.sql):
--   That RPC requires the caller to be the org owner for agent/client roles.
--   This RPC has no such restriction — it is for personal account removal only
--   and does NOT dissolve/delete the organization.
--
-- Run: Supabase SQL Editor → Execute
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_personal_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Remove from all organization memberships so the org continues without this user.
  DELETE FROM public.organization_members WHERE user_id = v_uid;

  -- Soft-delete: set the deletion marker. The existing cron/Edge function purges
  -- auth users after the grace period (default 30 days).
  UPDATE public.profiles
  SET deletion_requested_at = now()
  WHERE id = v_uid;
END;
$$;

-- Revoke from public (security best practice), grant only to authenticated users.
REVOKE ALL ON FUNCTION public.request_personal_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_personal_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.request_personal_account_deletion() IS
  'Soft-deletes the calling user''s personal account (sets deletion_requested_at) '
  'and removes them from all organization_members rows. '
  'Does NOT dissolve the organization. Available to all authenticated users regardless of role.';
