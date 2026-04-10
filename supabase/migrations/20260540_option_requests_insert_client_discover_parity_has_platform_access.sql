-- =============================================================================
-- 20260540: option_requests INSERT — Discover parity (has_platform_access)
--
-- Live (20260539): option_requests_insert_client used
-- has_platform_access_for_organization(COALESCE(client_organization_id, organization_id)).
-- Discover / can_access_platform path uses has_platform_access() (oldest membership).
-- Multi-org or per-org subscription drift can allow Discover + block INSERT (42501).
--
-- Restores 20260535-style WITH CHECK while keeping 20260538/39 COALESCE for
-- client_organization_id vs organization_id membership and qualified columns.
-- =============================================================================

DROP POLICY IF EXISTS option_requests_insert_client ON public.option_requests;

CREATE POLICY option_requests_insert_client
  ON public.option_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND public.has_platform_access()
    AND (
      COALESCE(option_requests.client_organization_id, option_requests.organization_id) IS NULL
      OR EXISTS (
        SELECT 1
        FROM   public.organization_members m
        WHERE  m.organization_id = COALESCE(option_requests.client_organization_id, option_requests.organization_id)
          AND  m.user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Client creates option_requests: client_id = auth.uid(); has_platform_access() '
  '(same bar as Discover / can_access_platform); effective client org = '
  'COALESCE(client_organization_id, organization_id); membership when set. '
  '20260540: Discover parity — do not use has_platform_access_for_organization '
  'in this policy without product review.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client INSERT policy missing after 20260540';
END $$;
