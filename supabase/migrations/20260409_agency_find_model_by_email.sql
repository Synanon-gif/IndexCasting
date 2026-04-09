-- =============================================================================
-- agency_find_model_by_email — Agency-scoped email dedup for model import
-- Date: 2026-04-09
--
-- PROBLEM:
--   importModelAndMerge() calls admin_find_model_by_email() which requires
--   assert_is_admin(). Agency users (role: agent) always get HTTP 400.
--   Without email dedup the INSERT path hits idx_models_email_unique → 409.
--   Net result: "Could not create or merge model" for every agency user
--   trying to add a model with an email that already exists.
--
-- FIX:
--   Agency-scoped SECURITY DEFINER RPC with org_members + bookers guard
--   (same pattern as 20260427 RPCs). Returns the model row if:
--   - Same agency (including soft-removed / ended)
--   - Unowned (agency_id IS NULL)
--   Admin bypass via is_current_user_admin() for backward compat.
--
-- COMPLIANCE:
--   Gefahr 2 / Risiko D: email lookup is server-side in SECURITY DEFINER,
--   not a frontend query. Guards 1-3 present. row_security=off with
--   explicit internal authorization — no RLS dependency.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agency_find_model_by_email(p_email text)
RETURNS SETOF public.models
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_caller_agency_id uuid;
BEGIN
  -- GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- GUARD 2: Caller must belong to an agency (org_members or legacy bookers)
  SELECT org.agency_id INTO v_caller_agency_id
  FROM public.organization_members om
  JOIN public.organizations org ON org.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND org.agency_id IS NOT NULL
    AND org.type = 'agency'
  ORDER BY om.created_at ASC
  LIMIT 1;
  -- LIMIT 1: Sub-Resource-Lookup after auth guard — deterministic for multi-org
  -- (same pattern as agency_update_model_full in 20260427)

  IF v_caller_agency_id IS NULL THEN
    SELECT b.agency_id INTO v_caller_agency_id
    FROM public.bookers b
    WHERE b.user_id = auth.uid()
    ORDER BY b.created_at ASC
    LIMIT 1;
  END IF;

  -- Admin bypass: admins can look up any model by email
  IF v_caller_agency_id IS NULL AND public.is_current_user_admin() THEN
    RETURN QUERY
      SELECT *
      FROM public.models
      WHERE email = lower(trim(p_email))
      LIMIT 1;
    RETURN;
  END IF;

  IF v_caller_agency_id IS NULL THEN
    RAISE EXCEPTION 'not_in_agency';
  END IF;

  -- GUARD 3: Return model only if it belongs to caller's agency or is unowned.
  -- Includes soft-removed (agency_relationship_status='ended') models so the
  -- caller can re-activate them instead of hitting a 409 on INSERT.
  RETURN QUERY
    SELECT *
    FROM public.models
    WHERE email = lower(trim(p_email))
      AND (agency_id = v_caller_agency_id OR agency_id IS NULL)
    LIMIT 1;
END;
$$;

REVOKE ALL    ON FUNCTION public.agency_find_model_by_email(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.agency_find_model_by_email(text) TO authenticated;

COMMENT ON FUNCTION public.agency_find_model_by_email IS
  'Agency-scoped: find a model row by email for import dedup. '
  'Guards: auth.uid() + org_members/bookers agency membership + admin bypass. '
  'Returns model only if same agency or unowned (agency_id IS NULL). '
  'Replaces admin_find_model_by_email in non-admin import flows. '
  'Gefahr 2 / Risiko D compliant: server-side SECURITY DEFINER lookup. '
  'Created 20260409.';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agency_find_model_by_email'
      AND p.prosecdef = true
      AND 'row_security=off' = ANY(p.proconfig)
  ), 'FAIL: agency_find_model_by_email missing SECURITY DEFINER or row_security=off';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'agency_find_model_by_email'
      AND prosrc NOT ILIKE '%owner_user_id%'
  ), 'FAIL: agency_find_model_by_email must not reference owner_user_id';

  RAISE NOTICE '20260409: agency_find_model_by_email created — OK';
END $$;
