-- ============================================================================
-- Billing System Evolution — Phase A: Member-write expansion (Operational + Presets)
-- 2026-11-20
--
-- Scope: Booker / Employee (= organization_members, not just owner) sollen
-- operationelle Billing-Aktionen ausführen können:
--   - Invoice drafts erstellen / editieren / Line Items
--   - Invoices senden (status transition draft → pending_send)
--   - Settlements erstellen / editieren / Mark paid
--   - Billing presets CRUD
--
-- Owner-only bleibt strikt für:
--   - organization_billing_profiles (alle DML)  → eigene Migration, unverändert
--   - organization_billing_defaults (alle DML)  → eigene Migration, unverändert
--   - invoices DELETE (drafts)                  → owner-only
--   - invoices UPDATE → 'void' / 'uncollectible' → owner-only (legal-risk)
--   - settlements DELETE (drafts)               → owner-only
--   - settlements status → 'void'               → owner-only
--
-- Model firewall (I-PAY-10) bleibt strukturell intakt: alle neuen Policies
-- nutzen is_org_member / is_org_owner, beide prüfen organization_members,
-- in dem Models per Architektur-Invariante (Fix H 2026-04-13) niemals stehen.
-- ============================================================================

-- ── invoices: drop owner-write policies, add member-write policies ─────────

DROP POLICY IF EXISTS "invoices_owner_insert"          ON public.invoices;
DROP POLICY IF EXISTS "invoices_owner_update_draft"    ON public.invoices;
-- DELETE bleibt owner-only (Migration 20261101: invoices_owner_delete_draft)

-- Members (incl. owner) dürfen Drafts erstellen
CREATE POLICY "invoices_member_insert_draft"
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND status = 'draft'
  );

-- Members (incl. owner) dürfen Drafts editieren UND status → pending_send
-- transitionieren (für UI Send-Flow). Void / uncollectible bleiben owner-only.
CREATE POLICY "invoices_member_update_draft"
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND status = 'draft'
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND status IN ('draft', 'pending_send')
  );

-- Owner-only update für legal-risk transitions (void / uncollectible) auf
-- bereits versendeten Invoices (nicht-draft).
CREATE POLICY "invoices_owner_update_void"
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    AND status IN ('sent', 'paid', 'overdue', 'pending_send')
  )
  WITH CHECK (
    public.is_org_owner(organization_id)
    AND status IN ('void', 'uncollectible', 'sent', 'paid', 'overdue', 'pending_send')
  );

COMMENT ON POLICY "invoices_member_insert_draft" ON public.invoices IS
  'Phase A 2026-11-20: Booker/Employee dürfen Drafts erstellen (Operational+Presets).';
COMMENT ON POLICY "invoices_member_update_draft" ON public.invoices IS
  'Phase A 2026-11-20: Booker/Employee dürfen Drafts editieren & senden (status draft→pending_send).';
COMMENT ON POLICY "invoices_owner_update_void" ON public.invoices IS
  'Owner-only: legal-risk transitions (void / uncollectible) auf nicht-draft invoices.';

-- ── invoice_line_items: drop owner-write, add member-write ─────────────────

DROP POLICY IF EXISTS "invoice_lines_owner_insert_draft" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_lines_owner_update_draft" ON public.invoice_line_items;
DROP POLICY IF EXISTS "invoice_lines_owner_delete_draft" ON public.invoice_line_items;

CREATE POLICY "invoice_lines_member_insert_draft"
  ON public.invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.organization_id)
    )
  );

CREATE POLICY "invoice_lines_member_update_draft"
  ON public.invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.organization_id)
    )
  );

CREATE POLICY "invoice_lines_member_delete_draft"
  ON public.invoice_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.status = 'draft'
        AND public.is_org_member(i.organization_id)
    )
  );

-- ── agency_model_settlements: member-write (status transitions) ────────────

DROP POLICY IF EXISTS "ams_owner_insert" ON public.agency_model_settlements;
DROP POLICY IF EXISTS "ams_owner_update" ON public.agency_model_settlements;
-- DELETE bleibt owner-only (ams_owner_delete_draft, Migration 20261111)

CREATE POLICY "ams_member_insert"
  ON public.agency_model_settlements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

-- Members dürfen status transitions außer 'void' (Owner-only)
CREATE POLICY "ams_member_update_nonvoid"
  ON public.agency_model_settlements
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND status IN ('draft', 'recorded', 'paid')
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND status IN ('draft', 'recorded', 'paid')
  );

-- Owner-only: status → 'void'
CREATE POLICY "ams_owner_update_void"
  ON public.agency_model_settlements
  FOR UPDATE TO authenticated
  USING (
    public.is_org_owner(organization_id)
  )
  WITH CHECK (
    public.is_org_owner(organization_id)
    AND status IN ('void', 'draft', 'recorded', 'paid')
  );

-- ── agency_model_settlement_items: member-write inside draft ───────────────

DROP POLICY IF EXISTS "amsi_owner_insert" ON public.agency_model_settlement_items;
DROP POLICY IF EXISTS "amsi_owner_update" ON public.agency_model_settlement_items;
DROP POLICY IF EXISTS "amsi_owner_delete" ON public.agency_model_settlement_items;

CREATE POLICY "amsi_member_insert"
  ON public.agency_model_settlement_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_member(s.organization_id)
        AND s.status = 'draft'
    )
  );

CREATE POLICY "amsi_member_update"
  ON public.agency_model_settlement_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_member(s.organization_id)
        AND s.status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_member(s.organization_id)
        AND s.status = 'draft'
    )
  );

CREATE POLICY "amsi_member_delete"
  ON public.agency_model_settlement_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_model_settlements s
      WHERE s.id = agency_model_settlement_items.settlement_id
        AND public.is_org_member(s.organization_id)
        AND s.status = 'draft'
    )
  );

-- ── agency_client_billing_presets: member-write ────────────────────────────

DROP POLICY IF EXISTS "acbp_agency_owner_insert" ON public.agency_client_billing_presets;
DROP POLICY IF EXISTS "acbp_agency_owner_update" ON public.agency_client_billing_presets;
DROP POLICY IF EXISTS "acbp_agency_owner_delete" ON public.agency_client_billing_presets;

CREATE POLICY "acbp_agency_member_insert"
  ON public.agency_client_billing_presets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(agency_organization_id));

CREATE POLICY "acbp_agency_member_update"
  ON public.agency_client_billing_presets
  FOR UPDATE TO authenticated
  USING (public.is_org_member(agency_organization_id))
  WITH CHECK (public.is_org_member(agency_organization_id));

CREATE POLICY "acbp_agency_member_delete"
  ON public.agency_client_billing_presets
  FOR DELETE TO authenticated
  USING (public.is_org_member(agency_organization_id));

-- ── Verification (manual) ──────────────────────────────────────────────────
-- After deploy:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('invoices','invoice_line_items','agency_model_settlements',
--                       'agency_model_settlement_items','agency_client_billing_presets')
--   ORDER BY tablename, cmd, policyname;
--
-- Expectations:
--   invoices: admin_all, member_select, recipient_owner_select,
--             member_insert_draft, member_update_draft, owner_update_void, owner_delete_draft
--   invoice_line_items: admin_all, select, member_(insert|update|delete)_draft
--   ams: admin_all, member_select, member_insert, member_update_nonvoid,
--        owner_update_void, owner_delete_draft
--   amsi: admin_all, member_select, member_(insert|update|delete)
--   acbp: admin_all, agency_member_select, agency_member_(insert|update|delete)
