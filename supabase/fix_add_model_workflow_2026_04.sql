-- =============================================================================
-- Fix Add Model Workflow — 2026-04
--
-- Fixes 4 bugs blocking the Agency "Add Model" flow:
--
-- 1. can_access_platform(): search_path missing 'extensions'
--    → function digest(text, unknown) does not exist (42883)
--
-- 2. get_org_member_emails(): not deployed → 404 Not Found
--
-- 3. models table: missing 'birthday' column → INSERT 400
--
-- 4. option_requests table: missing 'model_account_linked' column → SELECT 400
-- =============================================================================

-- ── 1. Fix can_access_platform(): add 'extensions' to search_path ─────────────
-- pgcrypto digest() lives in the extensions schema on Supabase.
-- The deployed version only has search_path=public → digest not found.

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET row_security TO off
AS $function$
DECLARE
  v_org_id        UUID;
  v_org_type      TEXT;
  v_override      admin_overrides%ROWTYPE;
  v_sub           organization_subscriptions%ROWTYPE;
  v_caller_email  TEXT;
  v_email_hash    TEXT;
  v_trial_blocked BOOLEAN := false;
BEGIN
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

  SELECT * INTO v_sub
  FROM   organization_subscriptions
  WHERE  organization_id = v_org_id;

  IF FOUND THEN
    IF v_sub.trial_ends_at > now() THEN
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

  RETURN jsonb_build_object(
    'allowed',         false,
    'reason',          'no_active_subscription',
    'organization_id', v_org_id,
    'org_type',        v_org_type
  );
END;
$function$;

ALTER FUNCTION public.can_access_platform() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.can_access_platform() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_platform() TO authenticated;

-- Also fix has_platform_access() wrapper (same search_path concern)
CREATE OR REPLACE FUNCTION public.has_platform_access()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET row_security TO off
AS $function$
BEGIN
  RETURN COALESCE(
    ((public.can_access_platform()) ->> 'allowed')::BOOLEAN,
    false
  );
END;
$function$;

ALTER FUNCTION public.has_platform_access() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.has_platform_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_platform_access() TO authenticated;

-- ── 2. Deploy get_org_member_emails() ─────────────────────────────────────────
-- Was never applied to the live DB. Defined in migration_rls_fix_profiles_email.sql.
-- Also add row_security=off to prevent potential recursion via profiles join.

CREATE OR REPLACE FUNCTION public.get_org_member_emails(p_org_id UUID)
RETURNS TABLE (user_id UUID, display_name TEXT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = p_org_id AND om.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT om.user_id, p.display_name, p.email
  FROM public.organization_members om
  JOIN public.profiles p ON p.id = om.user_id
  WHERE om.organization_id = p_org_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_org_member_emails(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_member_emails(UUID) TO authenticated;

-- ── 3. Add missing 'birthday' column to models ────────────────────────────────
-- importModelAndMerge sends birthday in every INSERT/UPDATE payload.
-- Without this column, every manual model add fails with HTTP 400.

ALTER TABLE public.models
  ADD COLUMN IF NOT EXISTS birthday DATE;

-- ── 4. Add missing 'model_account_linked' column to option_requests ───────────
-- getOptionRequestsForAgency selects this column. Without it, SELECT returns 400.

ALTER TABLE public.option_requests
  ADD COLUMN IF NOT EXISTS model_account_linked BOOLEAN NOT NULL DEFAULT false;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT array_to_string(proconfig, ',') FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public' AND proname = 'can_access_platform';
-- → should contain: search_path=public,extensions,row_security=off
--
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public' AND proname = 'get_org_member_emails';
-- → should return 1 row
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'models' AND column_name = 'birthday';
-- → should return 1 row
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'option_requests' AND column_name = 'model_account_linked';
-- → should return 1 row
-- =============================================================================
