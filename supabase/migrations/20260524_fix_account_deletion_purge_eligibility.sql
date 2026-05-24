-- Align soft account-deletion RPCs with gdpr_purge_expired_deletions eligibility.
-- Root cause: purge requires is_active = false but request_* RPCs only set deletion_requested_at.
-- Option A (minimal): set is_active = false on deletion request; restore on cancel.

-- ─── request_account_deletion (owner / model org user) ───────────────────────

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'agency'
    WHERE m.user_id = auth.uid()
      AND m.role::text <> 'owner'
  ) THEN
    RAISE EXCEPTION 'only_organization_owner_can_delete_account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'client'
    WHERE m.user_id = auth.uid()
      AND m.role::text <> 'owner'
  ) THEN
    RAISE EXCEPTION 'only_organization_owner_can_delete_account';
  END IF;

  UPDATE public.profiles
  SET deletion_requested_at = now(),
      is_active = false,
      updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Soft-delete request: sets profiles.deletion_requested_at and is_active=false. '
  'Owner gate uses organization_members + organizations.type only. '
  'Non-owners use request_personal_account_deletion. Eligible for gdpr_purge_expired_deletions after 30 days.';

-- ─── request_personal_account_deletion (booker / employee) ─────────────────

CREATE OR REPLACE FUNCTION public.request_personal_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM public.organization_members WHERE user_id = v_uid;

  UPDATE public.profiles
  SET deletion_requested_at = now(),
      is_active = false,
      updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.request_personal_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_personal_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.request_personal_account_deletion() IS
  'Soft-deletes the caller personal account (deletion_requested_at + is_active=false) '
  'and removes organization_members rows. Does NOT dissolve the organization.';

-- ─── cancel_account_deletion (within 30-day grace) ─────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET deletion_requested_at = NULL,
      is_active = true,
      updated_at = now()
  WHERE id = auth.uid()
    AND deletion_requested_at IS NOT NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

COMMENT ON FUNCTION public.cancel_account_deletion() IS
  'Withdraws account deletion request within grace period; clears deletion_requested_at and reactivates profile.';
