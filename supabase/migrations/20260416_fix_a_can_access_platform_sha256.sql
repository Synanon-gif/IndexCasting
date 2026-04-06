-- =============================================================================
-- Fix A: can_access_platform — Replace digest() with sha256() (no pgcrypto)
--
-- PROBLEM:
--   can_access_platform() calls encode(digest(lower(email), 'sha256'), 'hex')
--   which requires the pgcrypto extension. pgcrypto is NOT installed on this
--   project → function throws SQLSTATE 42883 at runtime → PostgREST returns
--   404 for every call to /rpc/can_access_platform.
--
-- FIX:
--   Replace digest(text, 'sha256') with sha256(bytea) which is built into
--   PostgreSQL 13+ without any extension. The hash value and hex encoding are
--   identical: encode(sha256(lower(email)::bytea), 'hex').
--
-- Idempotent: CREATE OR REPLACE.
-- =============================================================================

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
      -- Uses sha256() built-in (PG13+) — no pgcrypto extension required.
      SELECT email INTO v_caller_email
      FROM   auth.users
      WHERE  id = auth.uid();

      IF v_caller_email IS NOT NULL THEN
        v_email_hash := encode(sha256(lower(v_caller_email)::bytea), 'hex');

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

COMMENT ON FUNCTION public.can_access_platform IS
  'FIXED (20260416): replaced pgcrypto hash function with sha256(bytea) built-in. '
  'Returns paywall access status for the calling user''s organization.';

-- ─── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'can_access_platform'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ), 'FAIL: can_access_platform not found after recreate';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_access_platform'
      AND pg_get_functiondef(p.oid) ILIKE '%digest(%'
  ), 'FAIL: can_access_platform still references digest() — pgcrypto dependency not removed';
END $$;
