-- ============================================================================
-- Admin Bootstrap Fix — 2026-04-04c
--
-- Bug: ensure_plain_signup_b2b_owner_bootstrap() declares `prole public.user_role`
-- but profiles.role is TEXT. When admin (role='admin') logs in, PostgreSQL tries
-- to cast 'admin'::text -> public.user_role, which fails because 'admin' is NOT
-- in the enum (only model/agent/client are valid values).
-- This causes an uncaught exception on EVERY admin login, logged as:
--   "invalid input value for enum user_role: \"admin\""
--
-- Fix: Change the local variable to TEXT so the cast never fails.
--      The logic is unaffected: prole is only compared to 'client'/'agent'.
--
-- Also: Add explicit early-exit check for admin role so the B2B bootstrap
--       never runs unnecessary DB calls for the platform admin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prole  text;   -- ← was: public.user_role (caused enum cast error for admin)
  mcount int;
  aid    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Read role as TEXT to avoid enum cast failure for 'admin', 'guest', etc.
  SELECT role::text INTO prole FROM public.profiles WHERE id = auth.uid();

  IF prole IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;

  -- Only client and agent roles need B2B workspace bootstrapping.
  -- admin, model, guest → skip immediately.
  IF prole NOT IN ('client', 'agent') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_b2b');
  END IF;

  SELECT COUNT(*)::int INTO mcount FROM public.organization_members WHERE user_id = auth.uid();
  IF mcount > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'has_org_membership');
  END IF;

  IF prole = 'client' THEN
    PERFORM public.ensure_client_organization();
    RETURN jsonb_build_object('ok', true, 'bootstrap', 'client_owner');
  END IF;

  -- prole = 'agent'
  SELECT public.ensure_agency_for_current_agent() INTO aid;
  IF aid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'agency_row_failed');
  END IF;

  PERFORM public.ensure_agency_organization(aid);
  RETURN jsonb_build_object('ok', true, 'bootstrap', 'agency_owner', 'agency_id', aid);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() TO authenticated;

COMMENT ON FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap() IS
  'Fixed: local variable changed from user_role enum to text to prevent '
  'invalid enum cast for admin/model/guest roles. Logic unchanged.';
