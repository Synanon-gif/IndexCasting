-- =============================================================================
-- Security Fix: agency_invitations (legacy) & option_documents
--
-- Problem: Both tables have FOR ALL TO authenticated USING(true) WITH CHECK(true)
--   from migration_security_tighten.sql (which upgraded them from anon → auth).
--   Any authenticated user can still read, create, update, and delete all rows.
--
-- Note: The NEWER public.invitations table (from migration_organizations_invitations_rls.sql)
--   already has proper scoped RLS. This migration only addresses the LEGACY
--   public.agency_invitations table and public.option_documents.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. agency_invitations (legacy table – no agency_id/user_id FK available)
--    Scope to authenticated users with role = 'agent'.
--    The token is a 64-char hex secret – SELECT by token for onboarding
--    flows goes through the SECURITY DEFINER RPC get_invitation_preview(),
--    so public SELECT is not needed.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated can manage agency invitations" ON public.agency_invitations;
DROP POLICY IF EXISTS "Anyone can manage invitations"               ON public.agency_invitations;

-- Only agents (bookers/agency owners) may read legacy invitations.
CREATE POLICY "Agents can read legacy agency invitations"
  ON public.agency_invitations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  );

-- Only agents may create legacy invitations.
CREATE POLICY "Agents can insert legacy agency invitations"
  ON public.agency_invitations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  );

-- Only agents may update (e.g. mark as used) legacy invitations.
CREATE POLICY "Agents can update legacy agency invitations"
  ON public.agency_invitations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'agent'
    )
  );

-- No DELETE for legacy invitations (audit trail).
CREATE POLICY "No delete on legacy agency invitations"
  ON public.agency_invitations FOR DELETE TO authenticated
  USING (false);


-- -----------------------------------------------------------------------------
-- 2. option_documents
--    Scope to participants of the linked option_request via the existing
--    SECURITY DEFINER function option_request_visible_to_me().
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated can manage option documents" ON public.option_documents;
DROP POLICY IF EXISTS "Anyone can manage option documents"        ON public.option_documents;

CREATE POLICY "option_documents_select"
  ON public.option_documents FOR SELECT TO authenticated
  USING (public.option_request_visible_to_me(option_request_id));

CREATE POLICY "option_documents_insert"
  ON public.option_documents FOR INSERT TO authenticated
  WITH CHECK (public.option_request_visible_to_me(option_request_id));

-- UPDATE is intentionally not granted; documents should be immutable once uploaded.
-- DELETE: only if you can see the request (participant can retract own upload).
CREATE POLICY "option_documents_delete"
  ON public.option_documents FOR DELETE TO authenticated
  USING (public.option_request_visible_to_me(option_request_id));
