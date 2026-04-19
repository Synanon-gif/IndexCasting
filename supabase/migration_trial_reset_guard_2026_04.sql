-- =============================================================================
-- DEPRECATED / DO NOT EXECUTE — DIAGNOSE ONLY (NOT DEPLOYED via supabase CLI)
--
-- This file lives outside `supabase/migrations/` and is NOT auto-deployed.
-- Canonical, deployed sources of truth live in `supabase/migrations/YYYYMMDD_*.sql`.
-- Manual execution can introduce silent regressions on the live DB
-- (RLS recursion, weakened SECURITY DEFINER guards, broken admin access, etc.).
--
-- See: `.cursor/rules/system-invariants.mdc` (LIVE-DB SOURCE OF TRUTH),
--      `docs/LIVE_DB_DRIFT_GUARDRAIL.md`,
--      `docs/CONSISTENCY_FLOW_CHECK_2026-04-19.md` (Cluster F).
--
-- If you need to apply changes, create a new dated migration in `supabase/migrations/`.
-- =============================================================================

-- =============================================================================
-- Trial-Reset Guard: prevent repeated free trials per email identity.
--
-- Security finding (Attack Simulation 2026-04, HOCH):
--   can_access_platform() binds trial access to the organization, not the
--   user. An owner can delete their organization after the trial ends, create
--   a new one with a different email, and receive another fresh trial —
--   indefinitely. No fingerprinting or email deduplication was in place.
--
-- Fix:
--   1. Create public.used_trial_emails — stores SHA-256 hashes of emails
--      that have ever activated a trial. Hashing avoids storing plaintext
--      emails; collisions are negligible for our scale.
--
--   2. Create a trigger on organization_subscriptions: whenever a row is
--      inserted or updated with trial_ends_at IS NOT NULL, record the
--      SHA-256(email) of all current org members in used_trial_emails.
--
--   3. Update can_access_platform() to block 'trial_active' access when the
--      calling user's email hash is already in used_trial_emails (from a
--      different organization's trial). Admin overrides remain unaffected.
--
-- Notes:
--   - Existing active trials are grandfathered (no retroactive block).
--   - A user may still join a paying org — only trial_active is blocked.
--   - The email hash is computed server-side (pgcrypto) so the client never
--     influences which email is checked.
--   - Requires: CREATE EXTENSION IF NOT EXISTS pgcrypto.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. Trial fingerprint table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.used_trial_emails (
  email_hash  TEXT        PRIMARY KEY,   -- SHA-256(lower(email))
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_org  UUID        REFERENCES public.organizations(id) ON DELETE SET NULL
);

ALTER TABLE public.used_trial_emails ENABLE ROW LEVEL SECURITY;

-- Admins may read; no user may write directly (trigger-only writes).
DROP POLICY IF EXISTS "used_trial_emails_admin_select" ON public.used_trial_emails;
CREATE POLICY "used_trial_emails_admin_select"
  ON public.used_trial_emails
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

REVOKE INSERT, UPDATE, DELETE ON public.used_trial_emails FROM authenticated;

-- ─── 2. Trigger: record trial activations ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_trial_email_hashes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_record_trial_email_hashes ON public.organization_subscriptions;
CREATE TRIGGER trg_record_trial_email_hashes
  AFTER INSERT OR UPDATE OF trial_ends_at
  ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.record_trial_email_hashes();

-- ─── 3. Update can_access_platform() to check trial fingerprint ───────────────
--
-- Replaces migration_client_paywall.sql version.
-- Only the trial_active branch is modified; all other paths are unchanged.

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       UUID;
  v_org_type     TEXT;
  v_override     admin_overrides%ROWTYPE;
  v_sub          organization_subscriptions%ROWTYPE;
  v_caller_email TEXT;
  v_email_hash   TEXT;
  v_trial_blocked BOOLEAN := false;
BEGIN
  -- Resolve org_id AND org_type from auth.uid() — cannot be spoofed.
  SELECT om.organization_id, o.type
  INTO   v_org_id, v_org_type
  FROM   organization_members om
  JOIN   organizations o ON o.id = om.organization_id
  WHERE  om.user_id = auth.uid()
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
-- Check table exists:
-- SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='used_trial_emails';
--
-- Check trigger:
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'organization_subscriptions';
--
-- Check function returns trial_already_used for repeated email:
-- (Integration test required — insert a row in used_trial_emails with the
--  caller's email hash and call can_access_platform() as that user.)
