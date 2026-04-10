-- =============================================================================
-- 20260538: option_requests INSERT — option_requests_insert_client effective
-- client org via COALESCE(client_organization_id, organization_id)
--
-- Live (2026-04-10): option_requests_insert_client only referenced organization_id
-- for membership + has_platform_access_for_organization. When organization_id was
-- NULL but client_organization_id was set, the policy fell back to global
-- has_platform_access() (oldest-membership paywall), diverging from explicit
-- client org semantics and from rows where only client_organization_id is set.
--
-- Use the same effective client org key as product code: prefer
-- client_organization_id, then legacy organization_id.
--
-- NOTE: Qualify option_requests.* columns in EXISTS — unqualified organization_id
-- inside the subquery would bind to organization_members.organization_id (wrong).
-- =============================================================================

DROP POLICY IF EXISTS option_requests_insert_client ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND (
      (
        COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organization_members m
          WHERE  m.organization_id = COALESCE(option_requests.client_organization_id, option_requests.organization_id)
            AND  m.user_id = auth.uid()
        )
        AND public.has_platform_access_for_organization(
          COALESCE(option_requests.client_organization_id, option_requests.organization_id)
        )
      )
      OR (
        COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NULL
        AND public.has_platform_access()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Clients create option_requests: client_id = auth.uid(); effective client org = '
  'COALESCE(client_organization_id, organization_id); membership + '
  'has_platform_access_for_organization(effective org) when set; legacy NULL '
  'effective org keeps global has_platform_access(). 20260538 (option_requests.* '
  'qualified in EXISTS).';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client INSERT policy missing after 20260538';
END $$;
