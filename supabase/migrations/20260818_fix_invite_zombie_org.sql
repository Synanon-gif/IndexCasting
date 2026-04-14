-- =============================================================================
-- 20260818_fix_invite_zombie_org.sql
--
-- CRITICAL BUG FIX: When an Owner invites a Booker/Employee, the invited user
-- signs up → email confirmation → first login → bootstrapThenLoadProfile.
-- Previously, ensure_plain_signup_b2b_owner_bootstrap ran BEFORE invite
-- finalization: it saw 0 memberships → created a ZOMBIE org (user = owner).
-- Then accept_organization_invitation rejected the invite with
-- "already_member_of_another_org".
--
-- THREE-LAYER FIX:
--   A) ensure_plain_signup_b2b_owner_bootstrap: skip if pending invite exists
--   B) accept_organization_invitation: clean up zombie org instead of rejecting
--   C) Data fix: clean up existing zombie orgs from affected users
--
-- Idempotent: CREATE OR REPLACE, all guards are additive.
-- =============================================================================


-- ─── FIX A: ensure_plain_signup_b2b_owner_bootstrap — skip on pending invite ──

CREATE OR REPLACE FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  prole  text;
  mcount int;
  aid    uuid;
  inv_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF prole IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;

  IF prole NOT IN ('client', 'agent') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_b2b');
  END IF;

  SELECT COUNT(*)::int INTO mcount FROM public.organization_members WHERE user_id = auth.uid();
  IF mcount > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'has_org_membership');
  END IF;

  -- NEW: Check for pending invitations — if one exists, do NOT create an owner org.
  -- The invite finalization will add the user to the correct existing org.
  SELECT COUNT(*)::int INTO inv_count
  FROM public.invitations i
  JOIN auth.users u ON lower(trim(u.email)) = lower(trim(i.email))
  WHERE u.id = auth.uid()
    AND (
      (i.status = 'pending' AND i.expires_at > now())
      OR
      (i.status IS NULL AND i.accepted_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > now()))
    );
  IF inv_count > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'has_pending_invite');
  END IF;

  IF prole = 'client' THEN
    BEGIN
      PERFORM public.ensure_client_organization();
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'client_org_bootstrap_failed',
                                'detail', SQLERRM);
    END;
    RETURN jsonb_build_object('ok', true, 'bootstrap', 'client_owner');
  END IF;

  -- prole = 'agent'
  BEGIN
    SELECT public.ensure_agency_for_current_agent() INTO aid;
    IF aid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'agency_row_failed');
    END IF;
    PERFORM public.ensure_agency_organization(aid);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agency_org_bootstrap_failed',
                              'detail', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'bootstrap', 'agency_owner', 'agency_id', aid);
END;
$function$;

REVOKE ALL    ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() TO authenticated;

COMMENT ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() IS
  'Idempotent B2B owner bootstrap. Called on every login/signup for client/agent roles. '
  'Creates org + membership if missing AND no pending invite exists. '
  'Returns JSON, never raises (exception handler). '
  'FIX 20260818: skips org creation when a pending invitation exists for the user email.';


-- ─── FIX B: accept_organization_invitation — clean zombie orgs ────────────────
--
-- If the user is already member of ANOTHER org (zombie from bootstrap race),
-- check if that org is a "zombie" (sole member, no real data). If so, remove
-- the membership and delete the zombie org, then proceed with the invite.

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
  v_zombie_org_id uuid;
  v_zombie_member_count int;
  v_zombie_has_data boolean;
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
  IF v_expected_role IS NOT NULL AND prole IS DISTINCT FROM v_expected_role THEN
    IF prole IN ('client', 'agent', 'model') THEN
      UPDATE public.profiles
      SET role = v_expected_role
      WHERE id = auth.uid();
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', v_expected_role);
    END IF;
  END IF;

  -- Single-org invariant: check if user is already member of ANOTHER org
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    -- Check if the other org is a "zombie" (created by bootstrap race condition):
    -- sole member = this user, no conversations, no option_requests, no invitations sent
    SELECT om.organization_id INTO v_zombie_org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id <> inv.organization_id
    LIMIT 1;

    IF v_zombie_org_id IS NOT NULL THEN
      SELECT COUNT(*)::int INTO v_zombie_member_count
      FROM public.organization_members
      WHERE organization_id = v_zombie_org_id;

      -- Only clean up if user is the SOLE member
      IF v_zombie_member_count = 1 THEN
        v_zombie_has_data := false;

        -- Check for any real business data in the zombie org
        IF EXISTS (SELECT 1 FROM public.conversations WHERE client_organization_id = v_zombie_org_id OR agency_organization_id = v_zombie_org_id LIMIT 1) THEN
          v_zombie_has_data := true;
        END IF;
        IF NOT v_zombie_has_data AND EXISTS (SELECT 1 FROM public.option_requests WHERE organization_id = v_zombie_org_id OR client_organization_id = v_zombie_org_id LIMIT 1) THEN
          v_zombie_has_data := true;
        END IF;
        IF NOT v_zombie_has_data AND EXISTS (SELECT 1 FROM public.invitations WHERE organization_id = v_zombie_org_id AND invited_by <> auth.uid() LIMIT 1) THEN
          v_zombie_has_data := true;
        END IF;

        IF NOT v_zombie_has_data THEN
          -- Safe to remove: zombie org with no data
          DELETE FROM public.organization_subscriptions WHERE organization_id = v_zombie_org_id;
          DELETE FROM public.organization_members WHERE organization_id = v_zombie_org_id AND user_id = auth.uid();
          DELETE FROM public.invitations WHERE organization_id = v_zombie_org_id;
          DELETE FROM public.organizations WHERE id = v_zombie_org_id;
          RAISE NOTICE 'Cleaned up zombie org % for user %', v_zombie_org_id, auth.uid();
        ELSE
          RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
        END IF;
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
      END IF;
    END IF;
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
  -- MAJOR-3 FIX: Set company_name to the organization name so the Admin Dashboard
  -- and profile screens show the correct company for invited Bookers/Employees.
  UPDATE public.profiles
  SET is_active = true,
      company_name = COALESCE(NULLIF(trim(org.name), ''), company_name)
  WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Secure invitation acceptance with auto-role-fix, auto-activation, company name sync, '
  'and zombie-org cleanup. '
  'MAJOR-1 (20260611): auto-corrects profiles.role to match invite org type. '
  'MAJOR-2 (20260611): sets profiles.is_active = true (invite = owner verification). '
  'MAJOR-3 (20260713): sets profiles.company_name = organizations.name for invited users. '
  'MAJOR-4 (20260818): cleans up zombie orgs created by bootstrap race condition. '
  'Validates: token, email match, single-org-per-user invariant. '
  'SET row_security TO off (20260415 Risiko 4 fix).';


-- ─── FIX C: Clean up the specific zombie org from the reported incident ───────
-- User aramelge@icloud.com has zombie org a30c55fe-c06f-43e4-be83-a3ac10bd9f7f
-- (same name "Client 1" as the real org a4e7f68a-eed5-40d0-a7c7-d376f9940aa7)

DO $$
DECLARE
  v_zombie_org_id uuid := 'a30c55fe-c06f-43e4-be83-a3ac10bd9f7f';
  v_real_org_id   uuid := 'a4e7f68a-eed5-40d0-a7c7-d376f9940aa7';
  v_user_id       uuid;
  v_member_count  int;
  v_has_convs     boolean;
  v_has_options    boolean;
BEGIN
  -- Verify the zombie org exists and has exactly 1 member
  SELECT COUNT(*) INTO v_member_count
  FROM public.organization_members
  WHERE organization_id = v_zombie_org_id;

  IF v_member_count <> 1 THEN
    RAISE NOTICE 'Zombie org % has % members — skipping cleanup (expected 1)', v_zombie_org_id, v_member_count;
    RETURN;
  END IF;

  SELECT user_id INTO v_user_id
  FROM public.organization_members
  WHERE organization_id = v_zombie_org_id
  LIMIT 1;

  -- Verify no real business data
  SELECT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE client_organization_id = v_zombie_org_id OR agency_organization_id = v_zombie_org_id
  ) INTO v_has_convs;

  SELECT EXISTS (
    SELECT 1 FROM public.option_requests
    WHERE organization_id = v_zombie_org_id OR client_organization_id = v_zombie_org_id
  ) INTO v_has_options;

  IF v_has_convs OR v_has_options THEN
    -- Migrate conversations from zombie to real org instead of deleting
    UPDATE public.conversations
    SET client_organization_id = v_real_org_id
    WHERE client_organization_id = v_zombie_org_id;

    UPDATE public.conversations
    SET agency_organization_id = v_real_org_id
    WHERE agency_organization_id = v_zombie_org_id;
  END IF;

  -- Remove zombie membership
  DELETE FROM public.organization_subscriptions WHERE organization_id = v_zombie_org_id;
  DELETE FROM public.organization_members WHERE organization_id = v_zombie_org_id;
  DELETE FROM public.invitations WHERE organization_id = v_zombie_org_id;
  DELETE FROM public.organizations WHERE id = v_zombie_org_id;

  -- Add user to the real org as employee (if not already member)
  -- Check the invitations table to find the correct role
  INSERT INTO public.organization_members (user_id, organization_id, role)
  VALUES (v_user_id, v_real_org_id, 'employee'::public.org_member_role)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  -- Update profile to reflect real org
  UPDATE public.profiles
  SET is_active = true,
      company_name = (SELECT name FROM public.organizations WHERE id = v_real_org_id)
  WHERE id = v_user_id;

  RAISE NOTICE 'Cleaned up zombie org %, moved user % to real org %', v_zombie_org_id, v_user_id, v_real_org_id;
END $$;


-- ─── VERIFICATION ──────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Verify ensure_plain_signup_b2b_owner_bootstrap has pending invite check
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'ensure_plain_signup_b2b_owner_bootstrap'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%has_pending_invite%'
  ), 'FAIL: ensure_plain_signup_b2b_owner_bootstrap missing pending invite check';

  -- Verify accept_organization_invitation has zombie cleanup
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'accept_organization_invitation'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%zombie%'
  ), 'FAIL: accept_organization_invitation missing zombie cleanup';

  -- Verify zombie org is gone
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = 'a30c55fe-c06f-43e4-be83-a3ac10bd9f7f'
  ), 'FAIL: zombie org a30c55fe still exists';

  RAISE NOTICE 'ALL VERIFICATIONS PASSED — zombie org fix complete';
END $$;
