-- =============================================================================
-- 20260537: option_requests INSERT — option_requests_insert_client paywall per row org
--
-- Reverts the 20260535 change that bound INSERT to has_platform_access() only
-- (oldest-membership paywall). Aligns WITH CHECK with explicit client org when
-- organization_id is set: has_platform_access_for_organization(organization_id),
-- introduced in 20260534.
--
-- Live snapshot (pre-migration, 2026-04-10): public.option_requests had INSERT
-- policies option_requests_insert, option_requests_insert_agency,
-- option_requests_insert_client (all PERMISSIVE). SELECT/UPDATE per
-- option_request_visible_to_me / agency / client / model variants.
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
        option_requests.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM   public.organization_members m
          WHERE  m.organization_id = option_requests.organization_id
            AND  m.user_id = auth.uid()
        )
        AND public.has_platform_access_for_organization(option_requests.organization_id)
      )
      OR (
        option_requests.organization_id IS NULL
        AND public.has_platform_access()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Clients create option requests: client_id = auth.uid(); if organization_id set, '
  'membership + has_platform_access_for_organization(organization_id); legacy NULL '
  'organization_id keeps global has_platform_access(). 20260537 (restores 60534 '
  'INSERT branch after 60535 discover-parity regression).';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client INSERT policy missing after 20260537';
END $$;
