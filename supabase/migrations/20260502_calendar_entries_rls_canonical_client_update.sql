-- =============================================================================
-- Canonical calendar_entries RLS + client UPDATE parity (Audit A H1 + H2)
-- Date: 2026-05-02
--
-- H2: Single dated migration is source of intent for all calendar_entries RLS
--     policies (replaces reliance on root supabase/migration_*.sql for this table).
-- H1: Client org / legacy client user can UPDATE rows they already may SELECT
--     when tied to a non-rejected option_request via option_request_id.
--
-- Trust model unchanged: booking_details / booking_brief remain UI-filtered JSON;
-- this migration does NOT add field-level RLS inside JSONB.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE.
-- =============================================================================

-- ─── Drop legacy / superseded policy names ────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated can read calendar entries" ON public.calendar_entries;
DROP POLICY IF EXISTS "Authenticated can manage calendar entries" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_select_authenticated" ON public.calendar_entries;
DROP POLICY IF EXISTS "Agency can edit booking calendar entries" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_agency_org_all" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_model_user_all" ON public.calendar_entries;

DROP POLICY IF EXISTS "calendar_entries_select_scoped" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_write_agency" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_update_agency" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_delete_agency" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_model_self_insert" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_model_self_update" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_model_self_delete" ON public.calendar_entries;
DROP POLICY IF EXISTS "calendar_entries_update_client_scoped" ON public.calendar_entries;

-- ─── SELECT (scoped — same semantics as migration_security_hardening_audit_fixes) ─

CREATE POLICY "calendar_entries_select_scoped"
  ON public.calendar_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      WHERE orq.model_id = calendar_entries.model_id
        AND orq.client_id = auth.uid()
        AND orq.status <> 'rejected'::option_request_status
    )
    OR EXISTS (
      SELECT 1 FROM public.option_requests orq
      JOIN public.organization_members om ON om.user_id = auth.uid()
      JOIN public.organizations o ON o.id = om.organization_id
      WHERE orq.model_id = calendar_entries.model_id
        AND orq.organization_id = o.id
        AND orq.status <> 'rejected'::option_request_status
    )
  );

-- ─── Agency INSERT (no created_by_agency bypass — SQL-03 fix) ───────────────

CREATE POLICY "calendar_entries_write_agency"
  ON public.calendar_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_update_agency"
  ON public.calendar_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_delete_agency"
  ON public.calendar_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.bookers bk ON bk.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND bk.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      JOIN public.organization_members om ON om.organization_id = o.id
      WHERE m.id = calendar_entries.model_id
        AND om.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.models m
      JOIN public.organizations o ON o.agency_id = m.agency_id
      WHERE m.id = calendar_entries.model_id
        AND o.owner_id = auth.uid()
    )
  );

-- ─── Model self INSERT / UPDATE / DELETE ────────────────────────────────────

CREATE POLICY "calendar_entries_model_self_insert"
  ON public.calendar_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_model_self_update"
  ON public.calendar_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_entries_model_self_delete"
  ON public.calendar_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.models m
      WHERE m.id = calendar_entries.model_id
        AND m.user_id = auth.uid()
    )
  );

-- ─── H1: Client UPDATE — option_request_id pin + org / legacy client (narrow) ─

CREATE POLICY "calendar_entries_update_client_scoped"
  ON public.calendar_entries
  FOR UPDATE
  TO authenticated
  USING (
    calendar_entries.option_request_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.option_requests orq
      WHERE orq.id = calendar_entries.option_request_id
        AND orq.model_id = calendar_entries.model_id
        AND orq.status <> 'rejected'::option_request_status
        AND (
          orq.client_id = auth.uid()
          OR (
            orq.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.id = orq.organization_id
                AND o.type = 'client'::organization_type
            )
          )
        )
    )
  )
  WITH CHECK (
    calendar_entries.option_request_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.option_requests orq
      WHERE orq.id = calendar_entries.option_request_id
        AND orq.model_id = calendar_entries.model_id
        AND orq.status <> 'rejected'::option_request_status
        AND (
          orq.client_id = auth.uid()
          OR (
            orq.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.id = orq.organization_id
                AND o.type = 'client'::organization_type
            )
          )
        )
    )
  );

COMMENT ON POLICY "calendar_entries_update_client_scoped" ON public.calendar_entries IS
  'Client party (legacy client_id or client org member) may UPDATE option-linked rows for non-rejected options. Does not isolate JSONB fields; UI trust model unchanged.';
