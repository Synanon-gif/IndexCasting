-- =============================================================================
-- Security Fix: option_requests & connections – safety / idempotent cleanup
--
-- 1. option_requests: Re-drop any broad USING(true) policies and ensure scoped
--    ones via option_request_visible_to_me() exist (already done in
--    migration_organizations_invitations_rls.sql, but this is a safety net in
--    case earlier migrations were re-applied out of order).
-- 2. option_request_messages: Same safety net.
-- 3. client_agency_connections: DROP the broad UPDATE policy that was
--    inadvertently left in schema.sql and not removed in later migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. option_requests
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Agency can read option requests for their agency"   ON public.option_requests;
DROP POLICY IF EXISTS "Client can read own option requests"                ON public.option_requests;
DROP POLICY IF EXISTS "Client or agency can update option request"         ON public.option_requests;
DROP POLICY IF EXISTS "Client can create option request"                   ON public.option_requests;

-- Ensure scoped SELECT via is_org_member / option_request_visible_to_me
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_requests'
      AND policyname = 'option_requests_select_scoped'
  ) THEN
    CREATE POLICY option_requests_select_scoped
      ON public.option_requests FOR SELECT TO authenticated
      USING (public.option_request_visible_to_me(id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_requests'
      AND policyname = 'option_requests_insert_client'
  ) THEN
    CREATE POLICY option_requests_insert_client
      ON public.option_requests FOR INSERT TO authenticated
      WITH CHECK (
        client_id = auth.uid()
        AND (
          organization_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.organization_members m
            WHERE m.organization_id = organization_id AND m.user_id = auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_requests'
      AND policyname = 'option_requests_update_participant'
  ) THEN
    CREATE POLICY option_requests_update_participant
      ON public.option_requests FOR UPDATE TO authenticated
      USING (public.option_request_visible_to_me(id))
      WITH CHECK (public.option_request_visible_to_me(id));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. option_request_messages
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Participants can read option messages"   ON public.option_request_messages;
DROP POLICY IF EXISTS "Participants can insert option messages" ON public.option_request_messages;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_request_messages'
      AND policyname = 'option_messages_select_if_request_visible'
  ) THEN
    CREATE POLICY option_messages_select_if_request_visible
      ON public.option_request_messages FOR SELECT TO authenticated
      USING (public.option_request_visible_to_me(option_request_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_request_messages'
      AND policyname = 'option_messages_insert_if_request_visible'
  ) THEN
    CREATE POLICY option_messages_insert_if_request_visible
      ON public.option_request_messages FOR INSERT TO authenticated
      WITH CHECK (public.option_request_visible_to_me(option_request_id));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. client_agency_connections – drop the residual USING(true) UPDATE policy
--    from schema.sql that was never explicitly removed in later migrations.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Agency can update connection status" ON public.client_agency_connections;
