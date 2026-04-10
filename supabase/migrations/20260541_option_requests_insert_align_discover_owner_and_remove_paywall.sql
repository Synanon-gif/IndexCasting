-- =============================================================================
-- 20260541: option_requests INSERT — Discover / get_discovery_models parity
--
-- LIVE (2026-04-10): Three PERMISSIVE INSERT policies OR together:
--   option_requests_insert, option_requests_insert_agency, option_requests_insert_client
--
-- ROOT CAUSE:
--   get_discovery_models authorizes p_client_org_id via organization_members OR
--   organizations.owner_id (client org). Legacy option_requests_insert only checked
--   organization_members when client_organization_id IS NOT NULL — owner-only
--   bootstrap (no members row) failed both branches. option_requests_insert_client
--   also required has_platform_access() (global / oldest-org paywall) not present
--   in Discover RPC — 42501 on POST /rest/v1/option_requests.
--
-- FIX:
--   1) option_requests_insert: effective client org = COALESCE(client_organization_id,
--      organization_id); allow member OR client-org owner (same semantics as RPC).
--   2) option_requests_insert_client: remove has_platform_access(); same member OR
--      owner gate for COALESCE; client_id = auth.uid().
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
  'NULL org: client_id or created_by = auth.uid(). 20260541.';

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
  '20260541.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert missing after 20260541';

  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client missing after 20260541';
END $$;
