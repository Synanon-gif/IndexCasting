-- =============================================================================
-- 20260418_fix_invite_pending_check_dead_branch.sql
--
-- BUG: ensure_plain_signup_b2b_owner_bootstrap() and
-- accept_organization_invitation(text) reference the non-existent column
-- public.invitations.accepted_at in a logically-dead OR-branch:
--
--     (i.status IS NULL AND i.accepted_at IS NULL AND ...)
--
-- Live schema (verified 2026-04-18):
--   * invitations.status is NOT NULL, enum invitation_status ('pending'|'accepted')
--   * invitations.accepted_at does NOT exist
--   * invitations.accepted_by does NOT exist
--
-- plpgsql parses sub-statements lazily — so the SELECT only fails the first time
-- a code path actually reaches it (e.g. a brand-new user with 0 memberships).
-- When it does, PostgREST returns 400 with code 42703
-- ("column i.accepted_at does not exist"), breaking signup/login bootstrap.
--
-- FIX:
--   * Both functions: drop the dead `i.status IS NULL AND i.accepted_at IS NULL`
--     branch entirely. The remaining check `status = 'pending' AND expires_at > now()`
--     is the canonical (and only correct) pending-invite condition.
--   * accept_organization_invitation: drop the dead EXCEPTION WHEN undefined_column
--     branch that tried to write `accepted_at = now(), accepted_by = auth.uid()` —
--     these columns do not exist; status='accepted' is the canonical update.
--
-- Idempotent: CREATE OR REPLACE; behaviour-preserving for healthy invitations.
-- Rules referenced: .cursorrules §27.5 (Invite finalization),
--                   system-invariants.mdc INVITE-BEFORE-BOOTSTRAP INVARIANT,
--                   docs/LIVE_DB_DRIFT_GUARDRAIL.md (verify pg_get_functiondef).
-- =============================================================================


-- ─── FIX A: ensure_plain_signup_b2b_owner_bootstrap ──────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  prole     text;
  mcount    int;
  aid       uuid;
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

  -- Layer-2 INVITE-BEFORE-BOOTSTRAP guard (system-invariants.mdc):
  -- if a pending invitation exists for this user's email, do NOT create a
  -- zombie owner-org. The invite finalization will add the user to the
  -- correct existing org. `status` is NOT NULL with enum {pending,accepted};
  -- a single canonical check is sufficient.
  SELECT COUNT(*)::int INTO inv_count
  FROM public.invitations i
  JOIN auth.users u ON lower(trim(u.email)) = lower(trim(i.email))
  WHERE u.id = auth.uid()
    AND i.status = 'pending'
    AND i.expires_at > now();

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
  'FIX 20260818: skips org creation when a pending invitation exists for the user email. '
  'FIX 20260418: removed dead branch referencing non-existent column invitations.accepted_at '
  '(was 42703 on first-run bootstrap).';


-- ─── FIX B: accept_organization_invitation ───────────────────────────────────

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
  v_expected_role       text;
  v_zombie_org_id       uuid;
  v_zombie_member_count int;
  v_zombie_has_data     boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  -- Canonical pending-invite lookup. `status` is NOT NULL enum, so the only
  -- valid pending state is status='pending' with a non-expired window.
  SELECT * INTO inv
  FROM public.invitations
  WHERE token = p_token
    AND status = 'pending'
    AND expires_at > now()
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

  IF org.type = 'agency' THEN
    v_expected_role := 'agent';
  ELSIF org.type = 'client' THEN
    v_expected_role := 'client';
  ELSE
    v_expected_role := NULL;
  END IF;

  -- MAJOR-1 FIX (20260611): Auto-correct profile role to match invite org type.
  -- Email-match + valid token is sufficient verification.
  IF v_expected_role IS NOT NULL AND prole IS DISTINCT FROM v_expected_role THEN
    IF prole IN ('client', 'agent', 'model') THEN
      UPDATE public.profiles
      SET role = v_expected_role
      WHERE id = auth.uid();
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', v_expected_role);
    END IF;
  END IF;

  -- Single-org invariant + zombie-org cleanup (MAJOR-4, 20260818).
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    SELECT om.organization_id INTO v_zombie_org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id <> inv.organization_id
    LIMIT 1;

    IF v_zombie_org_id IS NOT NULL THEN
      SELECT COUNT(*)::int INTO v_zombie_member_count
      FROM public.organization_members
      WHERE organization_id = v_zombie_org_id;

      IF v_zombie_member_count = 1 THEN
        v_zombie_has_data := false;

        IF EXISTS (
          SELECT 1 FROM public.conversations
          WHERE client_organization_id = v_zombie_org_id
             OR agency_organization_id = v_zombie_org_id
          LIMIT 1
        ) THEN
          v_zombie_has_data := true;
        END IF;

        IF NOT v_zombie_has_data AND EXISTS (
          SELECT 1 FROM public.option_requests
          WHERE organization_id = v_zombie_org_id
             OR client_organization_id = v_zombie_org_id
          LIMIT 1
        ) THEN
          v_zombie_has_data := true;
        END IF;

        IF NOT v_zombie_has_data AND EXISTS (
          SELECT 1 FROM public.invitations
          WHERE organization_id = v_zombie_org_id
            AND invited_by <> auth.uid()
          LIMIT 1
        ) THEN
          v_zombie_has_data := true;
        END IF;

        IF NOT v_zombie_has_data THEN
          DELETE FROM public.organization_subscriptions WHERE organization_id = v_zombie_org_id;
          DELETE FROM public.organization_members      WHERE organization_id = v_zombie_org_id AND user_id = auth.uid();
          DELETE FROM public.invitations               WHERE organization_id = v_zombie_org_id;
          DELETE FROM public.organizations             WHERE id = v_zombie_org_id;
          RAISE NOTICE 'Cleaned up zombie org % for user %', v_zombie_org_id, auth.uid();
        ELSE
          RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
        END IF;
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
      END IF;
    END IF;
  END IF;

  -- Mark invitation accepted. `status` (enum invitation_status) is the only
  -- canonical column for acceptance; no separate timestamp column exists.
  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = inv.id;

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

  -- MAJOR-2 (20260611): activate profile (Owner's invite IS the verification).
  -- MAJOR-3 (20260713): sync company_name to organization name.
  UPDATE public.profiles
  SET is_active    = true,
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
  'FIX 20260418: removed dead branch referencing non-existent invitations.accepted_at / '
  'accepted_by columns (was 42703 in some race paths).';


-- ─── VERIFICATION ────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Both functions must NOT reference the non-existent column accepted_at.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'ensure_plain_signup_b2b_owner_bootstrap'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%accepted_at%'
  ), 'FAIL: ensure_plain_signup_b2b_owner_bootstrap still references accepted_at';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'accept_organization_invitation'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%accepted_at%'
  ), 'FAIL: accept_organization_invitation still references accepted_at';

  -- Pending-invite guard must remain in place
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'ensure_plain_signup_b2b_owner_bootstrap'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%has_pending_invite%'
  ), 'FAIL: ensure_plain_signup_b2b_owner_bootstrap missing pending invite check';

  -- Zombie cleanup must remain in place
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'accept_organization_invitation'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND prokind = 'f'
      AND pg_get_functiondef(oid) ILIKE '%zombie%'
  ), 'FAIL: accept_organization_invitation missing zombie cleanup';

  RAISE NOTICE 'OK — invitations.accepted_at dead branch removed; canonical pending check active';
END $$;
