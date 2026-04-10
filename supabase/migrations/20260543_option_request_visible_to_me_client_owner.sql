-- =============================================================================
-- 20260543: option_request_visible_to_me — client org owner parity with INSERT RLS
--
-- INSERT policies (20260541/20260542) allow creating option_requests when the
-- caller is organizations.owner_id for the effective client org
-- (COALESCE(client_organization_id, organization_id)) even if no
-- organization_members row exists yet (owner-only bootstrap).
--
-- INSERT ... RETURNING / PostgREST return=representation requires the new row to
-- pass SELECT policies (option_requests_select* → option_request_visible_to_me).
-- Without an owner branch, visibility failed while WITH CHECK passed → 42501.
--
-- Idempotent: full OR REPLACE of function body.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.option_request_visible_to_me(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
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

        -- Parity with option_requests INSERT WITH CHECK: client org owner without
        -- organization_members row (Discover / bootstrap).
        OR (
          COALESCE(oq.client_organization_id, oq.organization_id) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organizations oc
            WHERE oc.id = COALESCE(oq.client_organization_id, oq.organization_id)
              AND oc.type = 'client'::public.organization_type
              AND oc.owner_id = auth.uid()
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
  'RLS helper: option request visibility. 20260543: client org owner branch '
  '(COALESCE(client_organization_id, organization_id)) — parity with INSERT RLS / RETURNING.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'option_request_visible_to_me'
  ), 'FAIL: option_request_visible_to_me missing after 20260543';
END;
$$;
