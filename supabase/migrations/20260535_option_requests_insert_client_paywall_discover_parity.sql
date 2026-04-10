-- =============================================================================
-- 20260535: option_requests INSERT RLS — paywall parity with Discover
--
-- 20260534 bound INSERT to has_platform_access_for_organization(organization_id).
-- Discover / get_discovery_models uses has_platform_access() → can_access_platform()
-- (oldest membership). Multi-org or missing organization_subscriptions row for the
-- active client org then allowed Discover + add_model_to_project but blocked INSERT.
--
-- Restore COMBINED_HARDENING-style WITH CHECK: client_id, has_platform_access(),
-- membership when organization_id is set. Keeps has_platform_access_for_organization()
-- available for future explicit-org gates.
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
      option_requests.organization_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM   public.organization_members m
        WHERE  m.organization_id = option_requests.organization_id
          AND  m.user_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY option_requests_insert_client ON public.option_requests IS
  'Client creates option_requests: client_id = auth.uid(); has_platform_access() '
  '(same bar as Discover / can_access_platform oldest org); if organization_id set, '
  'caller must be a member. 20260535: parity with Discover after 20260534 per-org '
  'mismatch. Multi-org paywall remains documented LIMIT 1 on can_access_platform.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename = 'option_requests'
      AND  policyname = 'option_requests_insert_client'
      AND  cmd = 'INSERT'
  ), 'FAIL: option_requests_insert_client INSERT policy missing after 20260535';
END $$;
