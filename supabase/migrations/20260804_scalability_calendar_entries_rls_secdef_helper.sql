-- =============================================================================
-- Scalability H1: calendar_entries SELECT RLS — SECDEF helper
--
-- Problem: calendar_entries_select_scoped had 6 separate EXISTS subqueries
-- per row, each joining models/bookers/organization_members/option_requests.
-- At 200 calendar entries per agency user × 3000+ agency users = massive CPU.
--
-- Fix: Single SECURITY DEFINER helper function that resolves auth.uid() once,
-- then checks access via efficient lookups. The RLS policy delegates to this
-- helper, reducing per-row overhead from ~6 subqueries to ~2.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_view_calendar_entry(
  p_model_id uuid,
  p_option_request_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_agency_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  -- Check 1: Model self-access (cheapest)
  IF EXISTS (
    SELECT 1 FROM public.models m
    WHERE m.id = p_model_id AND m.user_id = v_uid
  ) THEN RETURN TRUE; END IF;

  -- Check 2: Agency access (booker or org member) — single lookup
  SELECT m.agency_id INTO v_agency_id
  FROM public.models m WHERE m.id = p_model_id;

  IF v_agency_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.bookers bk
      WHERE bk.agency_id = v_agency_id AND bk.user_id = v_uid
    ) THEN RETURN TRUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = v_agency_id AND om.user_id = v_uid
    ) THEN RETURN TRUE; END IF;
  END IF;

  -- Check 3: Client access via option_request (only if linked)
  IF p_option_request_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.option_requests orq
      WHERE orq.id = p_option_request_id
        AND orq.status <> 'rejected'::option_request_status
        AND (
          orq.client_id = v_uid
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            JOIN public.organizations o ON o.id = om.organization_id
            WHERE om.user_id = v_uid AND o.id = orq.organization_id
          )
        )
    ) THEN RETURN TRUE; END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.option_requests orq
      WHERE orq.model_id = p_model_id
        AND orq.status <> 'rejected'::option_request_status
        AND (
          orq.client_id = v_uid
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            JOIN public.organizations o ON o.id = om.organization_id
            WHERE om.user_id = v_uid AND o.id = orq.organization_id
          )
        )
    ) THEN RETURN TRUE; END IF;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_calendar_entry(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_calendar_entry(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_view_calendar_entry(uuid, uuid) IS
  'Scalability helper for calendar_entries SELECT RLS. Resolves uid once, '
  'checks agency membership via agency_id (not per-row models JOIN). 20260804.';

-- Replace the SELECT policy with the helper
DROP POLICY IF EXISTS "calendar_entries_select_scoped" ON public.calendar_entries;

CREATE POLICY "calendar_entries_select_scoped"
  ON public.calendar_entries
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_calendar_entry(model_id, option_request_id)
  );

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_view_calendar_entry'
  ), 'FAIL: can_view_calendar_entry missing after 20260804 migration';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'calendar_entries'
      AND policyname = 'calendar_entries_select_scoped'
      AND cmd = 'SELECT'
  ), 'FAIL: calendar_entries_select_scoped missing after 20260804 migration';
END;
$$;
