-- ============================================================================
-- Harden SECURITY DEFINER functions called from RLS policies
-- Date: 2026-04-05
--
-- These functions are called from within RLS policy USING/WITH CHECK clauses
-- and read RLS-protected tables. Without SET row_security TO off, PG15+
-- applies RLS to their internal queries — creating a latent recursion risk
-- if any referenced table later gains a policy that reads back.
--
-- Pattern established by: user_is_member_of_organization(),
--   is_current_user_admin(), is_current_user_super_admin(),
--   get_own_admin_flags() (all already fixed).
--
-- This migration hardens the remaining functions that follow the same
-- dangerous pattern: SECURITY DEFINER + reads protected tables + called
-- from RLS policies + missing row_security=off.
-- ============================================================================

-- ── 1. get_current_user_email() ─────────────────────────────────────────────
-- Reads: profiles (WHERE id = auth.uid())
-- Called from: recruiting_chat_messages, recruiting_chat_threads policies

CREATE OR REPLACE FUNCTION public.get_current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT email FROM public.profiles WHERE id = auth.uid();
$$;

ALTER FUNCTION public.get_current_user_email() OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.get_current_user_email() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_email() TO authenticated;

-- ── 2. can_access_platform() ────────────────────────────────────────────────
-- Reads: organization_members, organizations, admin_overrides,
--        organization_subscriptions, auth.users, used_trial_emails
-- Called from: has_platform_access() which is used in models, model_photos,
--             messages, option_requests policies

CREATE OR REPLACE FUNCTION public.can_access_platform()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $function$
DECLARE
  v_org_id       UUID;
  v_org_type     TEXT;
  v_override     admin_overrides%ROWTYPE;
  v_sub          organization_subscriptions%ROWTYPE;
  v_caller_email TEXT;
  v_email_hash   TEXT;
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

-- ── 3. has_platform_access() ────────────────────────────────────────────────
-- Wrapper around can_access_platform(). Also called directly from policies.

CREATE OR REPLACE FUNCTION public.has_platform_access()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

-- ── Verification ────────────────────────────────────────────────────────────
-- SELECT proname, array_to_string(proconfig, ',') as config
-- FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND proname IN ('get_current_user_email', 'can_access_platform',
--                   'has_platform_access')
-- ORDER BY proname;
-- → all should show row_security=off
-- ============================================================================
