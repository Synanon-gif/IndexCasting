-- =============================================================================
-- Security Audit Fixes — 2026-04-06
--
-- Fixes addressed:
--   BLOCKER 1: used_trial_emails admin policy still uses profiles.is_admin = true
--              → replaced with public.is_current_user_admin() (SECURITY DEFINER, UUID+email-pin)
--
--   HIGH 1a:   record_trial_email_hashes trigger function is SECURITY DEFINER but
--              lacks SET row_security TO off
--              → recreated with SET row_security TO off
--
--   HIGH 1b:   remove_org_member RPC is SECURITY DEFINER but lacks SET row_security TO off
--              → recreated with SET row_security TO off
--
--   HIGH 2:    can_access_platform() uses LIMIT 1 without ORDER BY for org resolution
--              → deterministic ORDER BY created_at ASC LIMIT 1 added
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE OR REPLACE
-- =============================================================================


-- ─── BLOCKER 1: Fix used_trial_emails admin select policy ────────────────────
--
-- PROBLEM: EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true)
-- After REVOKE SELECT (is_admin) FROM authenticated, is_admin returns NULL →
-- policy always evaluates to false → admin is locked out.
-- FIX: use public.is_current_user_admin() which is SECURITY DEFINER + UUID+email-pin.

DROP POLICY IF EXISTS "used_trial_emails_admin_select" ON public.used_trial_emails;

CREATE POLICY "used_trial_emails_admin_select"
  ON public.used_trial_emails
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Verify: the forbidden pattern must not appear in any policy on this table.
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename   = 'used_trial_emails'
      AND (qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%')
  ), 'FAIL: used_trial_emails still has is_admin=true policy';
  RAISE NOTICE 'PASS: used_trial_emails admin policy uses is_current_user_admin()';
END $$;


-- ─── HIGH 1a: record_trial_email_hashes — add SET row_security TO off ────────
--
-- Trigger function is SECURITY DEFINER and reads auth.users + organization_members.
-- Without SET row_security TO off, PostgreSQL 15+ applies RLS inside the function
-- which can cause recursive policy evaluation when called in a trigger context.

CREATE OR REPLACE FUNCTION public.record_trial_email_hashes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  -- Only act when a trial is being (re-)set on this org
  IF NEW.trial_ends_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only act on INSERT or when trial_ends_at changes
  IF TG_OP = 'UPDATE' AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at THEN
    RETURN NEW;
  END IF;

  -- Insert email hashes for all current org members, ignore conflicts
  INSERT INTO public.used_trial_emails (email_hash, source_org)
  SELECT
    encode(digest(lower(au.email), 'sha256'), 'hex'),
    NEW.organization_id
  FROM public.organization_members om
  JOIN auth.users au ON au.id = om.user_id
  WHERE om.organization_id = NEW.organization_id
    AND au.email IS NOT NULL
  ON CONFLICT (email_hash) DO NOTHING;

  RETURN NEW;
END;
$$;


-- ─── HIGH 1b: remove_org_member — add SET row_security TO off ────────────────
--
-- Reads organization_members (RLS-protected) inside a SECURITY DEFINER function.
-- Must have SET row_security TO off to avoid latent recursion in PG15+.

CREATE OR REPLACE FUNCTION public.remove_org_member(
  p_organization_id uuid,
  p_user_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Own membership: anyone may remove themselves
  IF p_user_id = auth.uid() THEN
    DELETE FROM public.organization_members
    WHERE organization_id = p_organization_id AND user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'removed_self', true);
  END IF;

  -- Foreign membership: only the org Owner may remove (via check_org_access)
  IF NOT (
    public.check_org_access(p_organization_id, 'agency', ARRAY['owner']::org_member_role[])
    OR
    public.check_org_access(p_organization_id, 'client', ARRAY['owner']::org_member_role[])
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_not_owner');
  END IF;

  DELETE FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_org_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) TO authenticated;


-- ─── HIGH 2: can_access_platform — deterministic org resolution ───────────────
--
-- PROBLEM: SELECT … FROM organization_members … LIMIT 1 without ORDER BY.
-- When a user has multiple organization_members rows (e.g. owner + invitee),
-- the chosen org is random across executions → different trial/subscription
-- results per call.
-- FIX: ORDER BY om.created_at ASC ensures the first-joined org is always chosen,
-- consistent with getMyOrgSubscription() and create-checkout-session Edge Function.

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_org_id        UUID;
  v_org_type      TEXT;
  v_override      admin_overrides%ROWTYPE;
  v_sub           organization_subscriptions%ROWTYPE;
  v_caller_email  TEXT;
  v_email_hash    TEXT;
  v_trial_blocked BOOLEAN := false;
BEGIN
  -- Resolve org_id AND org_type from auth.uid() — cannot be spoofed.
  -- ORDER BY created_at ASC: deterministic — always the first-joined org.
  SELECT om.organization_id, o.type
  INTO   v_org_id, v_org_type
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
  ORDER  BY om.created_at ASC
  LIMIT  1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'reason',   'no_org',
      'org_type', NULL
    );
  END IF;

  -- ── 1. Admin override ────────────────────────────────────────────────────
  SELECT * INTO v_override
  FROM   admin_overrides
  WHERE  organization_id = v_org_id;

  IF FOUND AND v_override.bypass_paywall THEN
    RETURN jsonb_build_object(
      'allowed',         true,
      'reason',          'admin_override',
      'plan',            COALESCE(v_override.custom_plan, 'admin'),
      'organization_id', v_org_id,
      'org_type',        v_org_type
    );
  END IF;

  -- ── 2 & 3. Subscription / trial ──────────────────────────────────────────
  SELECT * INTO v_sub
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  IF FOUND THEN
    -- Trial active
    IF v_sub.trial_ends_at > now() THEN
      -- Check whether this user's email has been used for a trial in a
      -- DIFFERENT organization — prevents trial reset by creating new orgs.
      SELECT email INTO v_caller_email
      FROM   auth.users
      WHERE  id = auth.uid();

      IF v_caller_email IS NOT NULL THEN
        v_email_hash := encode(digest(lower(v_caller_email), 'sha256'), 'hex');

        SELECT EXISTS (
          SELECT 1
          FROM   public.used_trial_emails ute
          WHERE  ute.email_hash = v_email_hash
            AND  ute.source_org IS DISTINCT FROM v_org_id
        ) INTO v_trial_blocked;
      END IF;

      IF v_trial_blocked THEN
        RETURN jsonb_build_object(
          'allowed',         false,
          'reason',          'trial_already_used',
          'organization_id', v_org_id,
          'org_type',        v_org_type
        );
      END IF;

      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'trial_active',
        'trial_ends_at',   v_sub.trial_ends_at,
        'plan',            COALESCE(v_sub.plan, 'trial'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;

    -- Subscription active
    IF v_sub.status IN ('active', 'trialing') THEN
      RETURN jsonb_build_object(
        'allowed',         true,
        'reason',          'subscription_active',
        'plan',            COALESCE(v_sub.plan, 'unknown'),
        'organization_id', v_org_id,
        'org_type',        v_org_type
      );
    END IF;
  END IF;

  -- ── 4. No access ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'allowed',         false,
    'reason',          'no_active_subscription',
    'organization_id', v_org_id,
    'org_type',        v_org_type
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.can_access_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated;


-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 1. Verify used_trial_emails policy is clean
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'used_trial_emails'
      AND (qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%')
  ), 'FAIL: used_trial_emails still has is_admin=true in policy';

  -- 2. Verify functions exist
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_trial_email_hashes'),
    'FAIL: record_trial_email_hashes not found';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'remove_org_member'),
    'FAIL: remove_org_member not found';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_access_platform'),
    'FAIL: can_access_platform not found';

  RAISE NOTICE 'PASS: 20260406_security_audit_fixes — all checks passed';
END $$;
