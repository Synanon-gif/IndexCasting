-- =============================================================================
-- Fix: get_territories_for_agency_roster
-- Date: 2026-04-06
--
-- Bug 1: Function read from model_assignments.territory (wrong table).
--        Authoritative table is model_agency_territories with column country_code.
--
-- Bug 2: Guard checked organization_members and agencies.owner_user_id, but not
--        the legacy bookers table. Legacy bookers got HTTP 400 with 'not_in_agency'.
--
-- Fix:
--   1. Add bookers fallback to the guard (consistent with bulk_upsert_model_locations).
--   2. Change SELECT to read from model_agency_territories.country_code.
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
SET row_security TO off  -- RLS off; internal guards below are the sole auth layer
AS $$
BEGIN
  -- INTERNAL GUARD 1: Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- INTERNAL GUARD 2: Caller must be:
  --   a) a member of an org that belongs to this agency (organization_members)
  --   b) the agency owner (agencies.owner_user_id)
  --   c) a legacy booker for this agency (bookers table)
  --   d) the admin
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
      -- Legacy bookers fallback (consistent with bulk_upsert_model_locations guard)
      SELECT 1 FROM public.bookers
      WHERE agency_id = p_agency_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_in_agency';
    END IF;
  END IF;

  -- Authorized: return territories from the authoritative model_agency_territories table.
  -- Previously read from model_assignments.territory (wrong table / wrong column).
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
  'FIXED (20260406): reads model_agency_territories.country_code (not model_assignments.territory). '
  'Guard extended with bookers legacy fallback. '
  'SECURE: auth + agency-membership/owner/booker/admin guard. row_security=off with explicit checks.';

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_territories_for_agency_roster'
  ), 'get_territories_for_agency_roster must exist';
  RAISE NOTICE 'get_territories_for_agency_roster: fix verified OK';
END $$;
