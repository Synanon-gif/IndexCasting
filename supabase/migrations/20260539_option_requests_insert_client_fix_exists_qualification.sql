-- =============================================================================
-- 20260539: Fix 20260538 — unqualified organization_id in EXISTS bound to
-- organization_members.organization_id (m.organization_id), breaking INSERT RLS.
-- Redefine option_requests_insert_client with option_requests.*-qualified columns.
-- Idempotent: full DROP/CREATE of same policy intent as corrected 20260538.
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
  'COALESCE(client_organization_id, organization_id) on option_requests row; '
  'membership + has_platform_access_for_organization(effective org); EXISTS uses '
  'qualified option_requests columns. 20260539.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client INSERT policy missing after 20260539';
END $$;
