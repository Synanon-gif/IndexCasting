-- =============================================================================
-- check_calendar_conflict — portfolio parity with Discovery (§27.1 / 20260523)
--
-- Problem: get_discovery_models can expose portfolio URLs from model_photos when
-- models.portfolio_images mirror is empty; check_calendar_conflict required
-- array_length(portfolio_images,1) > 0 only → clients saw 400 Access denied on
-- RPC while the same model appeared in Discover.
--
-- Fix: In the connectionless client guard, treat "has visible client portfolio"
-- as: non-empty portfolio_images OR at least one visible portfolio model_photos row
-- (same predicates as discovery enrichment in 20260523).
-- Idempotent. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_calendar_conflict(
  p_model_id uuid,
  p_date     date,
  p_start    time,
  p_end      time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
DECLARE
  v_entries   jsonb;
  v_count     integer;
  v_agency_id uuid;
  v_allowed   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT m.agency_id INTO v_agency_id
  FROM public.models m
  WHERE m.id = p_model_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Model not found';
  END IF;

  v_allowed :=
    public.is_current_user_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE o.agency_id = v_agency_id
        AND o.type = 'agency'
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.option_requests orq
      WHERE orq.model_id = p_model_id
        AND COALESCE(orq.status, '') NOT IN ('rejected', 'cancelled')
        AND (
          EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND orq.client_organization_id IS NOT NULL
              AND om.organization_id = orq.client_organization_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members om ON om.organization_id = oc.id
            WHERE oc.id = orq.organization_id
              AND oc.type = 'client'
              AND om.user_id = auth.uid()
          )
        )
    )
    OR (
      public.has_platform_access()
      AND public.caller_is_client_org_member()
      AND EXISTS (
        SELECT 1
        FROM public.models m
        WHERE m.id = p_model_id
          AND (m.is_visible_commercial = true OR m.is_visible_fashion = true)
          AND m.name IS NOT NULL
          AND trim(m.name) <> ''
          AND EXISTS (
            SELECT 1
            FROM public.model_agency_territories mat
            WHERE mat.model_id = m.id
          )
          AND (
            array_length(m.portfolio_images, 1) > 0
            OR EXISTS (
              SELECT 1
              FROM public.model_photos mp
              WHERE mp.model_id = m.id
                AND mp.photo_type = 'portfolio'
                AND mp.is_visible_to_clients = true
                AND COALESCE(mp.visible, true) = true
            )
          )
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Access denied: no permission to view this model''s calendar';
  END IF;

  SELECT
    COUNT(*),
    jsonb_agg(jsonb_build_object(
      'id',         ce.id,
      'entry_type', ce.entry_type,
      'start_time', ce.start_time,
      'end_time',   ce.end_time,
      'title',      ce.title
    ))
  INTO v_count, v_entries
  FROM public.calendar_entries ce
  WHERE ce.model_id = p_model_id
    AND ce.date = p_date
    AND ce.entry_type IN ('option', 'casting', 'job')
    AND (
      CASE
        WHEN ce.start_time IS NULL AND ce.end_time IS NULL THEN
          p_start IS NULL AND p_end IS NULL
        ELSE
          COALESCE(ce.start_time, '00:00:00'::time)
            < COALESCE(p_end, '23:59:59'::time)
          AND COALESCE(ce.end_time, '23:59:59'::time)
            > COALESCE(p_start, '00:00:00'::time)
      END
    );

  RETURN jsonb_build_object(
    'has_conflict',        v_count > 0,
    'conflicting_entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.check_calendar_conflict(uuid, date, time, time) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) TO authenticated;

COMMENT ON FUNCTION public.check_calendar_conflict(uuid, date, time, time) IS
  'Calendar overlap check for option/casting/job entries. '
  '20260529: client path portfolio check aligns with model_photos visible portfolio (§27.1) '
  'when portfolio_images mirror is empty.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_calendar_conflict'
  ), 'FAIL: check_calendar_conflict missing after migration';
END;
$$;
