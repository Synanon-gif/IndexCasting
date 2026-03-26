-- =============================================================================
-- SECURITY FIX: ensure_plain_signup_b2b_owner_bootstrap() – Syntax-Bug
--
-- Problem: Fehlende END IF nach dem ersten NULL-Check führte zu einem
--   PL/pgSQL Kompilierungsfehler. Die Funktion war nie ausführbar,
--   wodurch neu registrierte User (nach E-Mail-Bestätigung) keine Organisation
--   erhielten und dauerhaft "owner-los" blieben.
--
-- Fix: END IF korrekt platziert; Funktion komplett neu deployt.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_plain_signup_b2b_owner_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prole public.user_role;
  mcount int;
  aid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT role INTO prole FROM public.profiles WHERE id = auth.uid();

  IF prole IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_profile');
  END IF;  -- ← fehlte in der ursprünglichen Migration

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
  'Idempotent: if user has no organization_members rows, creates client or agency workspace owner. '
  'Safe after email confirmation login. Fixed: missing END IF after NULL check (was causing compile error).';
