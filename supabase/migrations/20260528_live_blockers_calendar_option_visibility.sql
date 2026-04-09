-- =============================================================================
-- Live blockers (2026-05-28): Package-adjacent RPC readiness, option request flow
--
-- 1) check_calendar_conflict — fix agency guard (organizations.agency_id, not
--    user_is_member_of_organization(agencies.id)); allow connectionless clients
--    who pass the same predicates as clients_read_visible_models + paywall;
--    keep admin bypass; merge refined NULL overlap logic from perf audit.
-- 2) option_request_visible_to_me — SET row_security TO off; add explicit
--    client-participant branch so INSERT...RETURNING is readable for creators.
-- Idempotent. Safe to re-run.
-- =============================================================================

-- ─── 1) check_calendar_conflict ─────────────────────────────────────────────

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

  -- Agency membership uses organizations.agency_id (= models.agency_id), NOT organizations.id.
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
          AND array_length(m.portfolio_images, 1) > 0
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
  'Guards: admin; agency org member for models.agency_id; existing option_requests participant; '
  'or client org member with platform access and discovery-equivalent model visibility. '
  '20260528: fix agency guard (org vs agency id confusion); connectionless client path.';

-- ─── 2) option_request_visible_to_me — row_security off + client creator branch

CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security TO off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.option_requests oq
    WHERE oq.id = p_request_id
      AND (
        EXISTS (
          SELECT 1 FROM public.models mo
          WHERE mo.id = oq.model_id AND mo.user_id = auth.uid()
        )

        OR (
          oq.client_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members mc
            WHERE mc.organization_id = oq.client_organization_id
              AND mc.user_id = auth.uid()
          )
        )

        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            JOIN public.organization_members mc ON mc.organization_id = oc.id
            WHERE oc.id = oq.organization_id
              AND oc.type = 'client'
              AND mc.user_id = auth.uid()
          )
        )

        OR (
          oq.client_organization_id IS NULL
          AND oq.organization_id IS NULL
          AND oq.client_id = auth.uid()
        )

        -- Explicit: creating client remains visible when org columns align with membership
        OR (
          oq.client_id = auth.uid()
          AND (
            EXISTS (
              SELECT 1 FROM public.organization_members mc
              WHERE mc.user_id = auth.uid()
                AND oq.client_organization_id IS NOT NULL
                AND mc.organization_id = oq.client_organization_id
            )
            OR EXISTS (
              SELECT 1
              FROM public.organizations oc
              JOIN public.organization_members mc ON mc.organization_id = oc.id
              WHERE oc.id = oq.organization_id
                AND oc.type = 'client'
                AND mc.user_id = auth.uid()
            )
          )
        )

        OR (
          oq.agency_organization_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_members ma
            WHERE ma.organization_id = oq.agency_organization_id
              AND ma.user_id = auth.uid()
              AND ma.role IN ('owner', 'booker')
          )
        )

        OR (
          oq.agency_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oa
            JOIN public.organization_members ma ON ma.organization_id = oa.id
            WHERE oa.agency_id = oq.agency_id
              AND oa.type = 'agency'
              AND ma.user_id = auth.uid()
              AND ma.role IN ('owner', 'booker')
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_to_me(uuid) TO authenticated;

COMMENT ON FUNCTION public.option_request_visible_to_me(uuid) IS
  'RLS helper: option request visibility. 20260528: SET row_security TO off; explicit client_id branch for RETURNING.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_calendar_conflict'
  ), 'FAIL: check_calendar_conflict missing after migration';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'option_request_visible_to_me'
  ), 'FAIL: option_request_visible_to_me missing after migration';
END;
$$;
