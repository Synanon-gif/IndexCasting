-- =============================================================================
-- Fix: Remove FOR ALL policies on calendar_entries and model_minor_consent
-- Date: 2026-04-06
-- Problem: FOR ALL includes SELECT. These policies read from models,
--          and models SELECT policies read model_agency_territories.
--          While the current model_agency_territories SELECT policy is
--          USING(true) (safe), FOR ALL on tables that reference models
--          creates a latent recursion risk per Risiko 5.
-- =============================================================================

-- ─── calendar_entries ───────────────────────────────────────────────────────
-- These FOR ALL policies are REDUNDANT: calendar_entries already has separate
-- SELECT (calendar_entries_select_scoped), INSERT (calendar_entries_write_agency),
-- UPDATE (calendar_entries_update_agency), DELETE (calendar_entries_delete_agency).

DROP POLICY IF EXISTS "calendar_entries_agency_org_all" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_model_user_all" ON public.calendar_entries;

-- calendar_entries_model_user_all covered INSERT/UPDATE/DELETE for model self.
-- The SELECT is already in calendar_entries_select_scoped.
-- Need to add model self INSERT/UPDATE/DELETE:

CREATE POLICY "calendar_entries_model_self_insert"
  ON public.calendar_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = calendar_entries.model_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_model_self_update"
  ON public.calendar_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = calendar_entries.model_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = calendar_entries.model_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_model_self_delete"
  ON public.calendar_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = calendar_entries.model_id AND m.user_id = auth.uid()
    )
  );

-- calendar_entries_agency_org_all covered agency org-member INSERT/UPDATE/DELETE.
-- INSERT is covered by calendar_entries_write_agency,
-- UPDATE by calendar_entries_update_agency,
-- DELETE by calendar_entries_delete_agency.
-- No new policies needed for agency.

-- ─── model_minor_consent ────────────────────────────────────────────────────
-- mmc_agency_access is FOR ALL (the ONLY policy on this table).
-- Must split into SELECT + INSERT + UPDATE + DELETE.

DROP POLICY IF EXISTS "mmc_agency_access" ON public.model_minor_consent;

CREATE POLICY "mmc_agency_select"
  ON public.model_minor_consent
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_minor_consent.model_id
        AND om.user_id = auth.uid()
        AND o.type = 'agency'
    )
  );

CREATE POLICY "mmc_agency_insert"
  ON public.model_minor_consent
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_minor_consent.model_id
        AND om.user_id = auth.uid()
        AND o.type = 'agency'
    )
  );

CREATE POLICY "mmc_agency_update"
  ON public.model_minor_consent
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_minor_consent.model_id
        AND om.user_id = auth.uid()
        AND o.type = 'agency'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_minor_consent.model_id
        AND om.user_id = auth.uid()
        AND o.type = 'agency'
    )
  );

CREATE POLICY "mmc_agency_delete"
  ON public.model_minor_consent
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM models m
      JOIN organizations o ON o.agency_id = m.agency_id
      JOIN organization_members om ON om.organization_id = o.id
      WHERE m.id = model_minor_consent.model_id
        AND om.user_id = auth.uid()
        AND o.type = 'agency'
    )
  );
