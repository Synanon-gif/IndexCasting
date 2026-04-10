-- =============================================================================
-- 20260542: option_requests INSERT RLS — idempotent reassert + guardrail
--
-- Live audit (2026-04-10): Production already matched 20260541; JWT simulation +
-- test INSERT (rollback) for client 874694… / org fac52092… succeeded.
-- Historical 42501 on older builds: WITH CHECK included has_platform_access()
-- (20260540) or has_platform_access_for_organization (20260538) while
-- get_discovery_models only gates member OR client org owner — Discover/Insert drift.
--
-- This migration re-applies the canonical 20260541 policies and asserts that
-- client INSERT policies do not reintroduce paywall predicates.
-- =============================================================================

DROP POLICY IF EXISTS option_requests_insert ON public.option_requests;

CREATE POLICY option_requests_insert
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM   public.organization_members om
          JOIN   public.organizations o ON o.id = om.organization_id
          WHERE  om.user_id = auth.uid()
            AND  o.type = 'client'
            AND  om.organization_id = COALESCE(
                   option_requests.client_organization_id,
                   option_requests.organization_id
                 )
        )
        OR EXISTS (
          SELECT 1
          FROM   public.organizations o
          WHERE  o.id = COALESCE(
                   option_requests.client_organization_id,
                   option_requests.organization_id
                 )
            AND o.type = 'client'
            AND o.owner_id = auth.uid()
        )
      )
    )
    OR (
      COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NULL
      AND (
        option_requests.client_id = auth.uid()
        OR option_requests.created_by = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert ON public.option_requests IS
  'Legacy client insert path: effective client org = COALESCE(client_organization_id, '
  'organization_id); member OR client org owner (parity with get_discovery_models). '
  'NULL org: client_id or created_by = auth.uid(). 20260541/20260542 reassert.';

DROP POLICY IF EXISTS option_requests_insert_client ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    option_requests.client_id = auth.uid()
    AND (
      COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NULL
      OR EXISTS (
        SELECT 1
        FROM   public.organization_members om
        JOIN   public.organizations o ON o.id = om.organization_id
        WHERE  om.user_id = auth.uid()
          AND  o.type = 'client'
          AND  om.organization_id = COALESCE(
                 option_requests.client_organization_id,
                 option_requests.organization_id
               )
      )
      OR EXISTS (
        SELECT 1
        FROM   public.organizations o
        WHERE  o.id = COALESCE(
                 option_requests.client_organization_id,
                 option_requests.organization_id
               )
          AND o.type = 'client'
          AND o.owner_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Client creates option_requests: client_id = auth.uid(); effective client org = '
  'COALESCE(client_organization_id, organization_id); member OR client org owner — '
  'parity with get_discovery_models / add_model_to_project (no has_platform_access). '
  '20260541/20260542 reassert.';

DO $$
DECLARE
  v_wc text;
BEGIN
  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO v_wc
  FROM   pg_policy p
  JOIN   pg_class c ON c.oid = p.polrelid
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relname = 'option_requests'
    AND  p.polname = 'option_requests_insert_client'
    AND  p.polcmd = 'a'::"char";

  IF v_wc IS NULL THEN
    RAISE EXCEPTION 'FAIL: option_requests_insert_client WITH CHECK missing after 20260542';
  END IF;

  IF v_wc ILIKE '%has_platform_access%' THEN
    RAISE EXCEPTION 'guardrail: option_requests_insert_client must not use has_platform_access (Discover parity)';
  END IF;

  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO v_wc
  FROM   pg_policy p
  JOIN   pg_class c ON c.oid = p.polrelid
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relname = 'option_requests'
    AND  p.polname = 'option_requests_insert'
    AND  p.polcmd = 'a'::"char";

  IF v_wc IS NULL THEN
    RAISE EXCEPTION 'FAIL: option_requests_insert WITH CHECK missing after 20260542';
  END IF;

  IF v_wc ILIKE '%has_platform_access%' THEN
    RAISE EXCEPTION 'guardrail: option_requests_insert must not use has_platform_access (Discover parity)';
  END IF;
END $$;
