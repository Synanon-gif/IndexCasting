-- =============================================================================
-- 20260544: option_requests SELECT — INSERT...RETURNING / PostgREST parity
--
-- ROOT CAUSE (Live-verified 2026-04-10):
--   option_request_visible_to_me(p_request_id) does EXISTS (...)
--   via "FROM option_requests oq WHERE oq.id = p_request_id".
--   For INSERT...RETURNING, PostgreSQL evaluates the SELECT policy on the new
--   row in the SAME command. A separate heap scan on option_requests in that
--   statement does NOT see the row yet (MVCC: cnt_same_stmt = 0), so the
--   function returns false → 42501 on RETURNING even when INSERT WITH CHECK
--   passed and membership/owner predicates are true.
--
-- FIX:
--   1) option_request_visible_from_columns(...) — same OR-logic as
--      option_request_visible_to_me, but takes column values (no self-read on
--      option_requests by id). RLS policies reference columns of the row
--      under check (available during INSERT RETURNING).
--   2) option_request_visible_to_me(uuid) — delegates to
--      option_request_visible_from_columns(...) using scalar subqueries on
--      option_requests (unchanged for callers that run when the row is visible:
--      storage, messages, id-based RPCs).
--   3) option_requests SELECT/UPDATE policies that used option_request_visible_to_me(id)
--      → use option_request_visible_from_columns(...) with direct column refs.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.option_request_visible_from_columns(
  p_model_id uuid,
  p_client_organization_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_agency_organization_id uuid,
  p_agency_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.models mo
      WHERE mo.id = p_model_id
        AND mo.user_id = auth.uid()
    )
    OR (
      p_client_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members mc
        WHERE mc.organization_id = p_client_organization_id
          AND mc.user_id = auth.uid()
      )
    )
    OR (
      p_client_organization_id IS NULL
      AND p_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organizations oc
        JOIN public.organization_members mc ON mc.organization_id = oc.id
        WHERE oc.id = p_organization_id
          AND oc.type = 'client'
          AND mc.user_id = auth.uid()
      )
    )
    OR (
      p_client_organization_id IS NULL
      AND p_organization_id IS NULL
      AND p_client_id = auth.uid()
    )
    OR (
      p_client_id = auth.uid()
      AND (
        EXISTS (
          SELECT 1
          FROM public.organization_members mc
          WHERE mc.user_id = auth.uid()
            AND p_client_organization_id IS NOT NULL
            AND mc.organization_id = p_client_organization_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.organizations oc
          JOIN public.organization_members mc ON mc.organization_id = oc.id
          WHERE oc.id = p_organization_id
            AND oc.type = 'client'
            AND mc.user_id = auth.uid()
        )
      )
    )
    OR (
      COALESCE(p_client_organization_id, p_organization_id) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organizations oc
        WHERE oc.id = COALESCE(p_client_organization_id, p_organization_id)
          AND oc.type = 'client'::public.organization_type
          AND oc.owner_id = auth.uid()
      )
    )
    OR (
      p_agency_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members ma
        WHERE ma.organization_id = p_agency_organization_id
          AND ma.user_id = auth.uid()
          AND ma.role IN ('owner', 'booker')
      )
    )
    OR (
      p_agency_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organizations oa
        JOIN public.organization_members ma ON ma.organization_id = oa.id
        WHERE oa.agency_id = p_agency_id
          AND oa.type = 'agency'
          AND ma.user_id = auth.uid()
          AND ma.role IN ('owner', 'booker')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_from_columns(uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_from_columns(uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.option_request_visible_from_columns(uuid, uuid, uuid, uuid, uuid, uuid) IS
  'RLS helper: option request visibility from row columns — INSERT RETURNING-safe (no self-read on option_requests). 20260544.';

-- Id-based wrapper: for callers that resolve when the row is visible in-table.
CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT public.option_request_visible_from_columns(
    (SELECT oq.model_id FROM public.option_requests oq WHERE oq.id = p_request_id),
    (SELECT oq.client_organization_id FROM public.option_requests oq WHERE oq.id = p_request_id),
    (SELECT oq.organization_id FROM public.option_requests oq WHERE oq.id = p_request_id),
    (SELECT oq.client_id FROM public.option_requests oq WHERE oq.id = p_request_id),
    (SELECT oq.agency_organization_id FROM public.option_requests oq WHERE oq.id = p_request_id),
    (SELECT oq.agency_id FROM public.option_requests oq WHERE oq.id = p_request_id)
  );
$$;

REVOKE ALL ON FUNCTION public.option_request_visible_to_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.option_request_visible_to_me(uuid) TO authenticated;

COMMENT ON FUNCTION public.option_request_visible_to_me(uuid) IS
  'RLS helper: id-based visibility; delegates to option_request_visible_from_columns. '
  'Safe for storage/messages when row exists. RLS on option_requests uses column helper. 20260544.';

-- Policies: column-based (INSERT RETURNING sees row columns; no id self-scan).
DROP POLICY IF EXISTS option_requests_select ON public.option_requests;
CREATE POLICY option_requests_select
  ON public.option_requests
  FOR SELECT
  TO authenticated
  USING (
    public.option_request_visible_from_columns(
      model_id,
      client_organization_id,
      organization_id,
      client_id,
      agency_organization_id,
      agency_id
    )
  );

DROP POLICY IF EXISTS option_requests_select_scoped ON public.option_requests;
CREATE POLICY option_requests_select_scoped
  ON public.option_requests
  FOR SELECT
  TO authenticated
  USING (
    public.option_request_visible_from_columns(
      model_id,
      client_organization_id,
      organization_id,
      client_id,
      agency_organization_id,
      agency_id
    )
  );

DROP POLICY IF EXISTS option_requests_update ON public.option_requests;
CREATE POLICY option_requests_update
  ON public.option_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.option_request_visible_from_columns(
      model_id,
      client_organization_id,
      organization_id,
      client_id,
      agency_organization_id,
      agency_id
    )
  )
  WITH CHECK (
    public.option_request_visible_from_columns(
      model_id,
      client_organization_id,
      organization_id,
      client_id,
      agency_organization_id,
      agency_id
    )
  );

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'option_request_visible_from_columns'
  ), 'FAIL: option_request_visible_from_columns missing after 20260544';
END;
$$;
