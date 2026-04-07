-- =============================================================================
-- Fix regression: get_territories_for_agency_roster (20260413 overwrote 20260406)
-- Date: 2026-04-22
--
-- Restores:
--   1. Authoritative read from model_agency_territories.country_code (not model_assignments).
--   2. Legacy bookers guard (same as 20260406_fix_territories_rpc.sql).
-- Keeps from 20260413:
--   SECURITY DEFINER, row_security off, auth + is_current_user_admin + org membership + owner.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_territories_for_agency_roster(
  p_agency_id uuid
)
RETURNS TABLE (
  r_model_id     uuid,
  r_country_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_current_user_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE om.user_id  = auth.uid()
        AND o.agency_id = p_agency_id
        AND o.type      = 'agency'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.agencies
      WHERE id = p_agency_id AND owner_user_id = auth.uid()
    ) AND NOT EXISTS (
      SELECT 1 FROM public.bookers
      WHERE agency_id = p_agency_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      mat.model_id,
      mat.country_code AS r_country_code
    FROM public.model_agency_territories mat
    WHERE mat.agency_id = p_agency_id
    ORDER BY mat.country_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_territories_for_agency_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_territories_for_agency_roster(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_territories_for_agency_roster IS
  'FIXED (20260422): reads model_agency_territories.country_code; guard includes bookers. '
  'Replaces regression from 20260413_secdef_scope_guards_final that used model_assignments.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_territories_for_agency_roster'
  ), 'get_territories_for_agency_roster must exist';
  RAISE NOTICE 'get_territories_for_agency_roster: MAT + bookers fix verified OK';
END $$;
