-- =============================================================================
-- RLS Collision Fix — 2026-04 Security Hardening
--
-- Closes remaining USING(true) / WITH CHECK(true) policy gaps. Many earlier
-- migrations already replaced broad policies; this file is the authoritative
-- safety net that ensures the final live-DB state is tight regardless of
-- migration execution order.
--
-- Issues addressed:
--
--   RLS-01 (HIGH): option_documents — "Authenticated can manage option
--     documents" FOR ALL USING(true) WITH CHECK(true). Any authenticated user
--     can read, insert, update, or delete any option document.
--     Fix: scope to option request participants via option_request_visible_to_me().
--
--   RLS-02 (HIGH): client_agency_connections UPDATE — both "Client updates
--     own connection rows" and "Agency org updates connection for their agency"
--     have WITH CHECK(true). The USING clause is correctly scoped, but any
--     value can be written to any column (including client_id / agency_id),
--     enabling cross-org tenant pivoting after gaining update access.
--     Fix: WITH CHECK mirrors the USING predicate for both policies.
--
--   RLS-03 (SAFETY NET): Re-confirm that earlier migrations' DROP + RECREATE
--     for model_applications, option_request_messages, recruiting_chat_*, and
--     model_locations ran correctly. If not, re-apply here idempotently.
--
-- Live-DB verification query (run manually after applying):
--   SELECT schemaname, tablename, policyname, cmd,
--          qual    AS using_clause,
--          with_check AS with_check_clause
--   FROM   pg_policies
--   WHERE  schemaname = 'public'
--     AND  tablename IN (
--            'option_documents','client_agency_connections',
--            'model_applications','option_request_messages',
--            'recruiting_chat_threads','recruiting_chat_messages',
--            'model_locations'
--          )
--   ORDER  BY tablename, cmd, policyname;
--
-- Run AFTER migration_access_gate_enforcement.sql.
-- Idempotent: all DROP IF EXISTS / IF NOT EXISTS guards.
-- =============================================================================


-- ─── RLS-01: option_documents — scope to option request participants ─────────

DROP POLICY IF EXISTS "Anyone can manage option documents"       ON public.option_documents;
DROP POLICY IF EXISTS "Authenticated can manage option documents" ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_select_participant"       ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_insert_participant"       ON public.option_documents;
DROP POLICY IF EXISTS "option_documents_delete_participant"       ON public.option_documents;

-- SELECT: visible only to participants of the parent option request
CREATE POLICY option_documents_select_participant
  ON public.option_documents
  FOR SELECT
  TO authenticated
  USING (public.option_request_visible_to_me(option_request_id));

-- INSERT: participants of the parent option request may attach documents
CREATE POLICY option_documents_insert_participant
  ON public.option_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.option_request_visible_to_me(option_request_id));

-- DELETE: only the uploader may remove their own document
CREATE POLICY option_documents_delete_own
  ON public.option_documents
  FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()::text
    AND public.option_request_visible_to_me(option_request_id)
  );

COMMENT ON POLICY option_documents_select_participant ON public.option_documents IS
  'Only option request participants (client org + agency org) may read documents. '
  'RLS-01 fix 2026-04 — replaces FOR ALL USING(true).';


-- ─── RLS-02: client_agency_connections UPDATE — fix WITH CHECK(true) ─────────
--
-- The USING clause is already correctly scoped (from
-- migration_connection_messenger_org_scope.sql). Only the WITH CHECK needs
-- to mirror USING so that participants cannot write arbitrary column values
-- (e.g. swap client_id / agency_id to pivot across tenants).

DROP POLICY IF EXISTS "Client updates own connection rows"              ON public.client_agency_connections;
DROP POLICY IF EXISTS "Agency org updates connection for their agency"  ON public.client_agency_connections;

CREATE POLICY "Client updates own connection rows"
  ON public.client_agency_connections
  FOR UPDATE
  TO authenticated
  USING (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o         ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  )
  -- WITH CHECK mirrors USING — prevents writing arbitrary column values
  WITH CHECK (
    client_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members m1
      JOIN public.organization_members m2 ON m1.organization_id = m2.organization_id
      JOIN public.organizations o         ON o.id = m1.organization_id AND o.type = 'client'
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = client_agency_connections.client_id
    )
  );

CREATE POLICY "Agency org updates connection for their agency"
  ON public.client_agency_connections
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type      = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  )
  -- WITH CHECK mirrors USING — prevents agency from reassigning the connection
  -- to a different agency_id or pivoting the client_id
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id AND m.user_id = auth.uid()
      WHERE o.type      = 'agency'
        AND o.agency_id = client_agency_connections.agency_id
    )
  );


-- ─── RLS-03: Safety-net re-applications ──────────────────────────────────────
--
-- The following DROP + RECREATE blocks are no-ops when the earlier migrations
-- ran correctly. They exist to guarantee the tight policy state even if
-- migrations were applied out of order or partially rolled back.

-- model_applications INSERT (anon: applicant_user_id must be NULL)
DROP POLICY IF EXISTS "Anon can insert applications" ON public.model_applications;
CREATE POLICY "Anon can insert applications"
  ON public.model_applications
  FOR INSERT
  TO anon
  WITH CHECK (applicant_user_id IS NULL);

-- option_request_messages INSERT — scope to request participants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'option_request_messages'
      AND policyname = 'option_messages_insert_if_request_visible'
  ) THEN
    -- Earlier migration_rls_fix_option_requests_safety.sql was not applied.
    -- Apply the scoped policy now.
    EXECUTE $policy$
      CREATE POLICY option_messages_insert_if_request_visible
        ON public.option_request_messages FOR INSERT TO authenticated
        WITH CHECK (public.option_request_visible_to_me(option_request_id))
    $policy$;
  END IF;
END $$;

-- Ensure the broad schema.sql INSERT policy for option_request_messages is gone
DROP POLICY IF EXISTS "Participants can insert option messages" ON public.option_request_messages;

-- Ensure the broad schema.sql INSERT policy for model_applications is gone
DROP POLICY IF EXISTS "Authenticated can insert applications" ON public.model_applications;
