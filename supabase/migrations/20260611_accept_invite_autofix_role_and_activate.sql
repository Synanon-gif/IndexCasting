-- =============================================================================
-- 20260611_accept_invite_autofix_role_and_activate.sql
--
-- MAJOR-1: accept_organization_invitation checks profiles.role but does not
-- fix it. An existing user with role='client' cannot accept an Agency invite
-- (role mismatch). The token stays retryable but there is no recovery path.
--
-- FIX: When a verified invite (email match, valid token, single-org) has a
-- role mismatch, auto-correct profiles.role to match the invite's org type.
-- This is safe because the invite was created by an org Owner for a specific
-- email — the email match IS the verification.
--
-- MAJOR-2: Invited users get is_active=false from handle_new_user. They land
-- on PendingActivationScreen even though an Owner explicitly invited them.
--
-- FIX: Set profiles.is_active = true after successful membership creation.
-- An invite by the org Owner IS the activation verification.
--
-- Supersedes: 20260415_accept_org_invite_row_security_fix.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  inv     public.invitations%ROWTYPE;
  org     public.organizations%ROWTYPE;
  uemail  text;
  prole   text;
  mem_cnt int;
  v_expected_role text;
BEGIN
  -- GUARD 1: authenticated
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token
    AND (
      (status = 'pending' AND expires_at > now())
      OR
      (status IS NULL AND accepted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  END IF;

  IF lower(trim(COALESCE(uemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = inv.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'org_not_found');
  END IF;

  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  -- Determine expected profile role based on org type
  IF org.type = 'agency' THEN
    v_expected_role := 'agent';
  ELSIF org.type = 'client' THEN
    v_expected_role := 'client';
  ELSE
    v_expected_role := NULL;
  END IF;

  -- MAJOR-1 FIX: Auto-correct profile role if it does not match the invite's
  -- org type. The email match + valid token is sufficient verification.
  -- Only fix for known B2B roles; admin/guest are never auto-corrected.
  IF v_expected_role IS NOT NULL AND prole IS DISTINCT FROM v_expected_role THEN
    IF prole IN ('client', 'agent', 'model') THEN
      UPDATE public.profiles
      SET role = v_expected_role
      WHERE id = auth.uid();
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', v_expected_role);
    END IF;
  END IF;

  -- Single-org invariant
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
  END IF;

  -- Mark invitation as accepted
  BEGIN
    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = inv.id;
  EXCEPTION WHEN undefined_column THEN
    UPDATE public.invitations
    SET accepted_at = now(), accepted_by = auth.uid()
    WHERE id = inv.id;
  END;

  -- Create membership (idempotent)
  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (
    auth.uid(),
    inv.organization_id,
    CASE inv.role
      WHEN 'booker'   THEN 'booker'::public.org_member_role
      WHEN 'employee' THEN 'employee'::public.org_member_role
      WHEN 'owner'    THEN 'owner'::public.org_member_role
      ELSE                 'employee'::public.org_member_role
    END
  )
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- MAJOR-2 FIX: Activate the profile — the Owner's invite IS the verification.
  -- Without this, invited users land on PendingActivationScreen.
  UPDATE public.profiles
  SET is_active = true
  WHERE id = auth.uid()
    AND is_active = false;

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Secure invitation acceptance with auto-role-fix and auto-activation. '
  'MAJOR-1 (20260611): auto-corrects profiles.role to match invite org type. '
  'MAJOR-2 (20260611): sets profiles.is_active = true (invite = owner verification). '
  'Validates: token, email match, single-org-per-user invariant. '
  'SET row_security TO off (20260415 Risiko 4 fix).';

-- ─── VERIFICATION ──────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'accept_organization_invitation'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%is_active = true%'
  ), 'FAIL: accept_organization_invitation missing is_active = true';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'accept_organization_invitation'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%v_expected_role%'
  ), 'FAIL: accept_organization_invitation missing auto-role-fix';

  RAISE NOTICE 'PASS: accept_organization_invitation — MAJOR-1 + MAJOR-2 fixed';
END $$;
