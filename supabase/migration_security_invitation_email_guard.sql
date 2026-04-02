-- =============================================================================
-- CRIT-01: Restore email verification in accept_organization_invitation
--
-- Problem: migration_enforce_single_org_per_user.sql (Phase 21) replaced the
-- accept_organization_invitation function with a version that removed:
--   - Email match check (inv.email = auth.users.email)
--   - Profile role check (org.type/inv.role must match profiles.role)
--   - 'status' column usage (was replaced with accepted_at IS NULL)
--
-- This allows ANY authenticated user with a valid token to join an organization
-- they were not invited to — a full invitation hijacking vulnerability.
--
-- This migration restores the full security checks while keeping the
-- single-org-per-user guard from Phase 21.
--
-- Combined checks:
--   1. Token must be valid (not accepted, not expired) — using status='pending'
--   2. Calling user's email must match invitation.email (case-insensitive)
--   3. User's profile role must match the org type (agent→agency, client→client)
--   4. User must not already belong to a different organization (Phase 21 guard)
--   5. Accept: mark invitation status='accepted', upsert membership
--
-- Column compatibility: uses 'status' column (original schema) because the
-- replace in Phase 21 assumed 'accepted_at' but the table was created with
-- 'status'. If the DB has already been migrated to accepted_at/accepted_by,
-- this migration handles both via EXCEPTION handling on the UPDATE.
--
-- Idempotent — safe to run multiple times.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv     public.invitations%ROWTYPE;
  org     public.organizations%ROWTYPE;
  uemail  text;
  prole   public.user_role;
  mem_cnt int;
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Resolve caller's email from auth.users (authoritative source, not spoofable)
  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  -- Fetch pending, non-expired invitation by token
  -- Supports both column schemas: status='pending' (original) and accepted_at IS NULL (Phase 21)
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

  -- SECURITY CHECK 1: Email must match the invitation recipient
  IF lower(trim(COALESCE(uemail, ''))) IS DISTINCT FROM lower(trim(COALESCE(inv.email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  -- Resolve organization
  SELECT * INTO org FROM public.organizations WHERE id = inv.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'org_not_found');
  END IF;

  -- SECURITY CHECK 2: Profile role must match the org type
  SELECT role INTO prole FROM public.profiles WHERE id = auth.uid();

  IF org.type = 'agency' AND inv.role = 'booker' AND prole IS DISTINCT FROM 'agent' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'agent');
  END IF;

  IF org.type = 'client' AND inv.role IN ('employee', 'owner') AND prole IS DISTINCT FROM 'client' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_profile_role', 'expected', 'client');
  END IF;

  -- SECURITY CHECK 3: Single-org-per-user guard (from Phase 21)
  SELECT COUNT(*) INTO mem_cnt
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id <> inv.organization_id;

  IF mem_cnt > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_member_of_another_org');
  END IF;

  -- Accept: mark invitation as used
  -- Try status column first (original schema), fall back to accepted_at (Phase 21 schema)
  BEGIN
    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = inv.id;
  EXCEPTION WHEN undefined_column THEN
    UPDATE public.invitations
    SET accepted_at = now(), accepted_by = auth.uid()
    WHERE id = inv.id;
  END;

  -- Upsert membership — role type is validated by trg_validate_org_member_role trigger
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

  RETURN jsonb_build_object('ok', true, 'organization_id', inv.organization_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.accept_organization_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text) TO authenticated;

COMMENT ON FUNCTION public.accept_organization_invitation(text) IS
  'Secure invitation acceptance: validates token, email match, profile role, '
  'and single-org-per-user invariant before granting membership. '
  'CRIT-01 fix: email_mismatch + wrong_profile_role checks restored.';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Confirm function body contains email check:
-- SELECT prosrc FROM pg_proc WHERE proname = 'accept_organization_invitation';
